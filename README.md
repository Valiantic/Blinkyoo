# blinkyoo AI - Setup Instructions

Welcome to blinkyoo. Follow these step-by-step instructions to set up the MVP locally.

## 1. Groq API Setup

To get the AI evaluation running:
1. Go to [Groq Console](https://console.groq.com/keys) and create a free account.
2. Under "API Keys", click **Create API Key**.
3. Copy your newly generated key.
4. In the `backend` directory, there is already an `.env.example`. Create a file named `.env` in the `backend/` directory.
5. Add your key like so:
   ```env
   GROQ_API_KEY=your_actual_key_here
   ```
6. The backend relies solely heavily on this key to give AI feedback. The system does not save any data to a database.

## 2. Webcam Permissions

- The browser will ask for Camera access when you click **INITIATE_SESSION**.
- Ensure you click **Allow**. 
- The camera frames are **strictly processed locally** inside your browser using MediaPipe. No video data or images are ever transmitted to the backend.
- If you accidentally block the camera:
  - In Chrome: click the camera icon with the red X in the right side of the URL bar, and specify "Always allow". Then reload the page.
  - The UI provides a fallback status indicator: `WARNING: CAMERA ACCESS_DENIED.`

## 3. Environment Configuration

### Frontend
- No special `.env` is required out of the box unless you host the backend somewhere else.
- If hosted remotely, create `.env.local` in `/frontend/`:
  ```env
  NEXT_PUBLIC_API_URL=http://your-remote-backend:8000
  ```

### Backend
- Ensure your `.env` contains the required `GROQ_API_KEY`. The database URL is no longer required, as blinkyoo runs statelessly.

## 4. Running the Project

1. **Start the Backend:**
   Open a terminal in the `backend` directory.
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On Mac/Linux:
   source venv/bin/activate
   pip install fastapi uvicorn groq python-dotenv pydantic "fastapi[standard]"
   uvicorn main:app --reload --port 8000
   ```

2. **Start the Frontend:**
   Open another terminal in the `frontend` directory.
   ```bash
   npm install
   npm run dev
   ```

3. **Connect Data Flows:**
   - Both services automatically link on localhost out of the box (Next.js on `3000`, FastAPI on `8000`).
   - Open your browser to `http://localhost:3000` to begin.
