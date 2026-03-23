import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

try:
    client = Groq(api_key=GROQ_API_KEY)
except Exception:
    client = None

def generate_focus_feedback(duration: float, tab_switches: int, away_seconds: float, focus_score: float) -> str:
    if not client:
        return "Groq API key not configured or invalid. No AI feedback available."
    
    prompt = f"""
    The user just finished a focus session using the blinkyoo app.
    Here are their stats:
    - Session Duration: {duration} minutes
    - Times switched tabs: {tab_switches}
    - Time away from screen/face not detected: {away_seconds} seconds
    - Final Focus Score: {focus_score}/100

    Write a short, engaging, and constructive 2-3 sentence feedback for the user in a calm, elegant, and gently firm tone.
    If the score is high, politely congratulate their focus. If low, give a refined suggestion to minimize distractions.
    """
    
    try:
        completion = client.chat.completions.create(
            # Using LLaMA 3.1 8b or Mixtral based on user preference
            model="llama-3.1-8b-instant", 
            messages=[
                {"role": "system", "content": "You are blinkyoo, an elegant and sophisticated productivity assistant."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=150,
            top_p=1,
            stream=False,
            stop=None,
        )
        return completion.choices[0].message.content
    except Exception as e:
        return f"Could not generate AI feedback: {str(e)}"
