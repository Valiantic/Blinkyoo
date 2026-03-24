import ctypes
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from groq_service import generate_focus_feedback

app = FastAPI(title="Blinkyoo Backend")

# Enable CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SessionEvaluation(BaseModel):
    duration_minutes: float
    tab_switches: int
    away_seconds: float
    focus_score: float

@app.get("/")
def read_root():
    return {"status": "Blinkyoo Backend Running"}

@app.get("/active-window")
def active_window():
    if os.name != 'nt':
        return {"title": "Unsupported Platform (Cloud)"}
    try:
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
        return {"title": buf.value}
    except Exception as e:
        return {"title": ""}

@app.get("/windows")
def get_windows():
    if os.name != 'nt':
        return {"windows": ["Unsupported Platform (Cloud)"]}
    try:
        EnumWindows = ctypes.windll.user32.EnumWindows
        EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
        GetWindowTextW = ctypes.windll.user32.GetWindowTextW
        GetWindowTextLengthW = ctypes.windll.user32.GetWindowTextLengthW
        IsWindowVisible = ctypes.windll.user32.IsWindowVisible

        titles = set()
        def foreach_window(hwnd, lParam):
            if IsWindowVisible(hwnd):
                length = GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value
                    titles.add(title)
            return True
        
        EnumWindows(EnumWindowsProc(foreach_window), 0)
        return {"windows": list(titles)}
    except Exception as e:
        return {"windows": []}

@app.post("/evaluate")
def evaluate_session(session_data: SessionEvaluation):
    # Generate Groq feedback automatically when session ends
    feedback = generate_focus_feedback(
        duration=session_data.duration_minutes,
        tab_switches=session_data.tab_switches,
        away_seconds=session_data.away_seconds,
        focus_score=session_data.focus_score
    )
    return {"ai_feedback": feedback}
