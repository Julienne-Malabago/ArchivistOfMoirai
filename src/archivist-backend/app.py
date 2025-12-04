from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from google import genai
import os 
import json
import random

# --- 1. CONFIGURATION AND INITIALIZATION ---
app = Flask(__name__)
# Enable CORS for frontend running on a different port/domain
CORS(app) 

# Initialize Firebase Admin SDK (Used for secure server-side Firestore access)
# IMPORTANT: You MUST place your Firebase service account key file (downloaded from Firebase Console) 
# named 'serviceAccountKey.json' in the same directory as this app.py file.
try:
    # Attempt to load credentials from a file path
    cred = credentials.Certificate("serviceAccountKey.json")
        
    firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"Failed to initialize Firebase Admin. Ensure 'serviceAccountKey.json' is present: {e}")
    db = None

# Initialize Google Gemini Client
# Assumes GEMINI_API_KEY environment variable is set
try:
    gemini_client = genai.Client()
except Exception as e:
    print(f"Failed to initialize Gemini Client. Ensure GEMINI_API_KEY is set: {e}")
    gemini_client = None

# Game Constants
AXIOMS = ['Fate', 'Choice', 'Chance']
BASE_SCORE_INCREASE = 100

# --- 2. GEMINI PROMPTING LOGIC ---
def get_system_prompt(difficulty_tier):
    """Generates the structured system prompt for the AI based on difficulty."""
    subtlety_instruction = ""
    if difficulty_tier >= 2:
        subtlety_instruction = "The narrative deception must be subtle. The false axiom should be strongly suggested, but the true axiom must only be revealed by a single, nuanced detail."
    if difficulty_tier >= 5:
        subtlety_instruction = "The deception must be highly complex. The false axiom should dominate the narrative flow, requiring the user to identify a latent, non-obvious clue to find the true, underlying axiom."

    return f"""
    You are the Fragment Weaver of the Athenaeum of Moirai. Your task is to generate a short, emotionally driven story fragment (around 4-6 sentences) based on a SECRET_TAG.
    The story must strongly suggest one of the other two Axioms (narrative deception), but the final outcome must be clearly defined by the SECRET_TAG.
    The possible Axioms are: Fate (inevitable predetermination), Choice (a critical, preventable decision), or Chance (random, unpreventable external occurrence).

    Current Difficulty Tier: {difficulty_tier}. {subtlety_instruction}

    After generating the story, generate a separate, short 'Revelation Text' that justifies why the SECRET_TAG is the definitive causal force, explaining the narrative deception.
    
    Format your entire response as a single JSON object ONLY. Do not include any text outside the JSON block.
    """

def call_gemini_api(tag, difficulty):
    """Handles the API call to Gemini to generate the fragment and revelation."""
    if not gemini_client:
        return {"fragment": "AI service is unavailable.", "revelationText": "Cannot connect to the Weaver."}

    system_prompt = get_system_prompt(difficulty)
    
    # Instruct the AI to generate a fragment for a specific tag
    user_prompt = f"Generate a Fragment where the true underlying Axiom is: {tag}"
    
    try:
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=user_prompt,
            config=genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                response_schema={
                    "type": "object",
                    "properties": {
                        "fragment": {"type": "string"},
                        "revelationText": {"type": "string"},
                    },
                    "required": ["fragment", "revelationText"]
                }
            )
        )
        # Parse the JSON string output from the model
        return json.loads(response.text)
        
    except Exception as e:
        print(f"Gemini API call error: {e}")
        return {"fragment": "Error generating fragment.", "revelationText": "Error during generation."}

# --- 3. API ENDPOINTS ---

@app.route('/api/generate_fragment', methods=['POST'])
def generate_fragment():
    """Endpoint to generate a new story fragment."""
    data = request.get_json()
    user_id = data.get('userId')
    difficulty = data.get('difficulty', 1)

    if not user_id or not db:
        return jsonify({"error": "User ID or database unavailable."}), 500

    # 1. Select the secret axiom
    secret_tag = random.choice(AXIOMS)

    # 2. Call the AI to generate content
    ai_response = call_gemini_api(secret_tag, difficulty)

    # 3. Store the secret tag and revelation text in a temporary user session/cache
    # Stored in /game_sessions/{userId}
    try:
        db.collection('game_sessions').document(user_id).set({
            'secret_tag': secret_tag,
            'revelation_text': ai_response['revelationText'],
            'timestamp': firestore.SERVER_TIMESTAMP,
            'fragment_id': str(random.randint(100000, 999999)) 
        })
    except Exception as e:
        print(f"Firestore save error: {e}")

    return jsonify({
        "fragment": ai_response['fragment'],
        # The true axiom is securely stored on the server side
    })


@app.route('/api/classify_fragment', methods=['POST'])
def classify_fragment():
    """Endpoint to check the user's classification and update stats."""
    data = request.get_json()
    user_id = data.get('userId')
    user_axiom = data.get('userAxiom')

    if not user_id or not user_axiom or not db:
        return jsonify({"error": "Missing data or database unavailable."}), 500

    # 1. Retrieve the secret tag and revelation from the game session
    session_ref = db.collection('game_sessions').document(user_id)
    session_snap = session_ref.get()
    
    if not session_snap.exists:
        return jsonify({"error": "No active fragment session found. Please generate a new fragment."}), 404

    session_data = session_snap.to_dict()
    secret_tag = session_data.get('secret_tag')
    revelation_text = session_data.get('revelation_text')

    is_correct = (user_axiom == secret_tag)

    # 2. Update User Stats
    user_ref = db.collection('users').document(user_id)
    user_data = user_ref.get().to_dict()
    
    if not user_data:
        return jsonify({"error": "User profile not found."}), 404

    new_score = user_data.get('currentScore', 0)
    new_streak = user_data.get('currentStreak', 0)
    highest_streak = user_data.get('highestStreak', 0)
    new_difficulty = user_data.get('difficultyTier', 1)

    if is_correct:
        # Score increases faster with higher difficulty
        new_score += BASE_SCORE_INCREASE * new_difficulty
        new_streak += 1
        highest_streak = max(highest_streak, new_streak)

        # Difficulty Scaling Logic (Every 5 consecutive correct answers)
        if new_streak > 0 and new_streak % 5 == 0:
            new_difficulty += 1
    else:
        new_streak = 0
    
    # Update Firestore
    user_ref.update({
        'currentScore': new_score,
        'currentStreak': new_streak,
        'highestStreak': highest_streak,
        'difficultyTier': new_difficulty
    })
    
    # Delete the temporary session data
    session_ref.delete()

    # 3. Return the result and revelation to the frontend
    return jsonify({
        "isCorrect": is_correct,
        "trueAxiom": secret_tag,
        "revelationText": revelation_text,
        "newScore": new_score,
        "newStreak": new_streak,
        "newDifficulty": new_difficulty
    })


# --- 4. RUN SERVER ---
if __name__ == '__main__':
    # When deploying, ensure the host and port are correctly configured for your platform
    # For local development:
    app.run(debug=True)