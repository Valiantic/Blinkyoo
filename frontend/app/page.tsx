"use client";

import { useEffect, useState, useRef } from "react";
import CameraFocus from "../components/CameraFocus";
import { evaluateSession } from "../lib/api";
import { Play, Square, AlertTriangle, Monitor, X, Activity, Smartphone, EyeOff, LayoutTemplate, Pause } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type SessionState = "idle" | "running" | "paused" | "ended";

export default function Home() {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionTimeLeft, setSessionTimeLeft] = useState(25 * 60);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(25);

  const [tabSwitches, setTabSwitches] = useState(0);
  const [awaySeconds, setAwaySeconds] = useState(0);
  const [isFaceMissing, setIsFaceMissing] = useState(false);
  const [isPhoneDetected, setIsPhoneDetected] = useState(false);

  const [targetWebsites, setTargetWebsites] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [isAppDistracted, setIsAppDistracted] = useState(false);
  const [availableWindows, setAvailableWindows] = useState<string[]>([]);
  const distractionPingsRef = useRef(0);

  const [currentFeedback, setCurrentFeedback] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const penaltyTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [notifications, setNotifications] = useState<{ id: number, text: string, type: 'warning' | 'info' | 'danger' }[]>([]);

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
      oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (err) {
      // Audio not supported
    }
  };

  const addNotification = (text: string, type: 'warning' | 'info' | 'danger' = 'warning') => {
    if (type === 'danger' || type === 'warning') playBeep();

    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);

    if (typeof window !== 'undefined' && "Notification" in window) {
      if (Notification.permission === 'granted') {
        const options: any = {
          body: text,
          tag: 'blinkyoo-focus-alert',
          renotify: true,
          icon: '/window.svg',
          vibrate: [200, 100, 200],
          silent: false,
          requireInteraction: true
        };

        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification("Blinkyoo Alert", options);
          }).catch(() => {
            const n = new Notification("Blinkyoo Alert", options);
            n.onclick = () => { window.focus(); n.close(); };
          });
        } else {
          const n = new Notification("Blinkyoo Alert", options);
          n.onclick = () => { window.focus(); n.close(); };
        }
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            addNotification(text, type); // Retry once after permission
          }
        });
      }
    }
  };

  // Register SW for background background notifications
  // Tab switching detector
  useEffect(() => {
    if (sessionState === "running") {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = '';
      };

      const handleVisibilityChange = () => {
        // Only enforce tab switches for local browser mode (no targets).
        // If they have targets, the polling loop below handles the OS-wide distraction counting.
        if (document.hidden && targetWebsites.length === 0 && sessionState === "running") {
          setTabSwitches(prev => prev + 1);
          addNotification("Focus lost from tab. Please return immediately.", "warning");
        }
      };

      window.addEventListener('beforeunload', handleBeforeUnload);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [sessionState, targetWebsites]);

  // Main Session Countdown Timer
  useEffect(() => {
    if (sessionState === "running") {
      timerRef.current = setInterval(() => {
        setSessionTimeLeft(prev => prev > 0 ? prev - 1 : 0);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionState]);

  // Fetch visible windows list
  useEffect(() => {
    if (sessionState === "idle") {
      const fetchWindows = async () => {
        try {
          const res = await fetch("http://localhost:8000/windows");
          if (res.ok) {
            const data = await res.json();
            if (data.windows) setAvailableWindows(data.windows);
          }
        } catch (e) { }
      };
      fetchWindows();
      const interval = setInterval(fetchWindows, 3000);
      return () => clearInterval(interval);
    }
  }, [sessionState]);

  // Native App Window Polling
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (sessionState === "running" && targetWebsites.length > 0) {
      interval = setInterval(async () => {
        try {
          const res = await fetch("http://localhost:8000/active-window");
          if (res.ok) {
            const data = await res.json();
            const activeTitle = data.title.toLowerCase();

            const isMatched = targetWebsites.some(target => {
              if (!target || target.trim() === "") return false;

              let keywords: string[] = [];

              if (target.includes('.') || target.includes('/') || target.includes(':')) {
                try {
                  const urlStr = target.startsWith('http') ? target : `http://${target}`;
                  const url = new URL(urlStr);
                  const domainParts = url.hostname.split('.');
                  keywords = domainParts.filter(p => !['com', 'edu', 'gov', 'net', 'org', 'www', 'io', 'co', 'app'].includes(p.toLowerCase()));
                  const pathParts = url.pathname.split('/').filter(p => p.length > 3);
                  keywords = [...keywords, ...pathParts];
                } catch (e) {
                  keywords = target.toLowerCase().split(/[\/.:\-_]+/).filter(w => w.length >= 2);
                }
              } else {
                keywords = target.toLowerCase().split(/[\s\-_]+/).filter(w => w.length >= 2);
              }

              const stopWords = ['app', 'tab', 'window', 'browser', 'website', 'the', 'my', 'a'];
              const filteredKeywords = keywords.filter(k => !stopWords.includes(k.toLowerCase()));

              if (filteredKeywords.length === 0) return false;

              // Use 'every' to ensure all target keywords are in the title (better precision)
              return filteredKeywords.every(keyword => activeTitle.includes(keyword.toLowerCase()));
            });

            const ignoreWindowsExact = ["task switching", "program manager", "search", "start", "workspace", "desktop", "task view"];
            const ignoreWindowsPartial = ["windows default lock screen", "new tab - google chrome", "new tab - microsoft​ edge"];

            const isIgnored = ignoreWindowsExact.includes(activeTitle.trim()) ||
              ignoreWindowsPartial.some(ignore => activeTitle.includes(ignore));

            if (activeTitle && !isIgnored && !isMatched && !activeTitle.includes("blinkyoo")) {
              distractionPingsRef.current += 1;
              if (distractionPingsRef.current >= 2) { // 2 pings = 3 seconds buffer
                if (!isAppDistracted) setTabSwitches(prev => prev + 1);
                setIsAppDistracted(true);
              }
            } else {
              distractionPingsRef.current = 0;
              setIsAppDistracted(false);
            }
          }
        } catch (e) { }
      }, 1500);
    } else {
      distractionPingsRef.current = 0;
      setIsAppDistracted(false);
    }
    return () => clearInterval(interval);
  }, [sessionState, targetWebsites]);

  useEffect(() => {
    if (isAppDistracted) {
      addNotification(`You left your assigned focus app!`, "warning");
    }
  }, [isAppDistracted]);

  // Handle Timeout
  useEffect(() => {
    if (sessionState === "running" && sessionTimeLeft === 0) {
      handleEndSession();
    }
  }, [sessionTimeLeft, sessionState]);

  // Penalty Timer (Face Missing OR Phone Detected OR App Distracted)
  useEffect(() => {
    if (sessionState === "running" && (isFaceMissing || isPhoneDetected || isAppDistracted)) {
      penaltyTimerRef.current = setInterval(() => {
        setAwaySeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (penaltyTimerRef.current) clearInterval(penaltyTimerRef.current);
    }
    return () => {
      if (penaltyTimerRef.current) clearInterval(penaltyTimerRef.current);
    };
  }, [sessionState, isFaceMissing, isPhoneDetected, isAppDistracted]);

  const requestNotificationPermission = async () => {
    if ("Notification" in window) {
      if (Notification.permission !== "granted") {
        await Notification.requestPermission();
      }
    }
  };

  const handleStartSession = async () => {
    await requestNotificationPermission();
    setSessionState("running");
    setSessionTimeLeft(sessionDurationMinutes * 60);
    setTabSwitches(0);
    setAwaySeconds(0);
    setIsFaceMissing(false);
    setIsPhoneDetected(false);
    setIsAppDistracted(false);
    setCurrentFeedback(null);
    addNotification(`Session initiated for ${sessionDurationMinutes} minutes. Stay focused.`, "info");
  };

  const handleEndSession = async () => {
    setSessionState("ended");
    let calculatedScore = Math.max(0, 100 - (tabSwitches * 5) - (Math.floor(awaySeconds / 10)));

    addNotification("Session completed. Evaluating metrics...", "info");

    try {
      const result = await evaluateSession({
        duration_minutes: sessionDurationMinutes,
        tab_switches: tabSwitches,
        away_seconds: awaySeconds,
        focus_score: calculatedScore
      });
      setCurrentFeedback(result.ai_feedback);
    } catch (err) {
      setCurrentFeedback("Oops. AI evaluation failed. Check backend connection.");
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // UI Components
  return (
    <div className="min-h-screen p-4 md:p-12 relative flex flex-col md:flex-row gap-8 selection:bg-violet-200 selection:text-violet-900 container mx-auto">
      {/* HUD Notifications */}
      <div className="fixed top-8 right-8 z-50 flex flex-col gap-4">
        <AnimatePresence>
          {notifications.map(n => (
            <motion.div
              key={n.id}
              initial={{ x: 100, opacity: 0, scale: 0.9 }}
              animate={{ x: 0, opacity: 1, scale: 1 }}
              exit={{ x: 100, opacity: 0, scale: 0.9 }}
              className={`p-4 min-w-[320px] rounded-2xl glass-panel shadow-xl flex gap-3 text-sm font-medium ${n.type === 'warning' ? 'bg-orange-50/90 text-orange-600 border border-orange-200' :
                n.type === 'danger' ? 'bg-red-50/90 text-red-600 border border-red-200' :
                  'bg-violet-50/90 text-violet-700 border border-violet-200'
                }`}
            >
              {n.type === 'danger' ? <Smartphone size={20} /> : n.type === 'warning' ? <AlertTriangle size={20} /> : <Activity size={20} />}
              <div>
                <strong className="block text-xs uppercase opacity-70 mb-0.5 font-bold tracking-wider">
                  {n.type === 'info' ? 'Update' : 'Alert'}
                </strong>
                {n.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Main Core View */}
      <div className="flex-1 max-w-5xl glass-panel rounded-3xl p-8 md:p-16 flex flex-col items-center justify-center relative shadow-2xl overflow-hidden border border-white/60">

        {/* Soft Background Accents inside panel */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-violet-100 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-fuchsia-100 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>

        <div className="relative z-10 w-full flex flex-col items-center flex-1 justify-center">
          {sessionState === "running" ? (
            <>
              {/* Penalty Status Tags */}
              <div className="absolute top-0 right-0 gap-3 flex flex-col items-end">
                <AnimatePresence>
                  {isFaceMissing && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-red-100/80 backdrop-blur-md text-red-700 border border-red-200 font-bold px-4 py-2 rounded-full text-xs shadow-sm flex items-center gap-2">
                      <EyeOff size={14} /> USER AWAY
                    </motion.div>
                  )}
                  {isPhoneDetected && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-orange-100/80 backdrop-blur-md text-orange-700 border border-orange-200 font-bold px-4 py-2 rounded-full text-xs shadow-sm flex items-center gap-2">
                      <Smartphone size={14} /> PHONE DETECTED
                    </motion.div>
                  )}
                  {isAppDistracted && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-orange-100/80 backdrop-blur-md text-orange-700 border border-orange-200 font-bold px-4 py-2 rounded-full text-xs shadow-sm flex items-center gap-2">
                      <LayoutTemplate size={14} /> OFF TARGET
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <h1 className="text-7xl md:text-[12rem] leading-none font-[var(--font-display)] font-light text-violet-600 transition-colors drop-shadow-sm">
                {formatTime(sessionTimeLeft)}
              </h1>

              <div className="flex flex-wrap gap-8 my-10 justify-center">
                <div className="glass-panel-violet rounded-2xl p-6 text-center w-48 shadow-sm">
                  <div className="text-violet-500 font-semibold tracking-wide text-xs mb-2 uppercase">Tab Switches</div>
                  <div className={`text-4xl font-[var(--font-display)] font-bold ${tabSwitches > 0 ? 'text-red-500' : 'text-violet-800'}`}>{tabSwitches}</div>
                </div>
                <div className="glass-panel-violet rounded-2xl p-6 text-center w-48 shadow-sm">
                  <div className="text-violet-500 font-semibold tracking-wide text-xs mb-2 uppercase">Penalty Time</div>
                  <div className={`text-4xl font-[var(--font-display)] font-bold ${awaySeconds > 0 ? 'text-orange-500' : 'text-violet-800'}`}>{awaySeconds}s</div>
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button
                  onClick={() => setSessionState(sessionState === "running" ? "paused" : "running")}
                  className={`hover:bg-violet-50 border-2 border-violet-200 text-violet-600 font-bold py-4 px-10 rounded-full text-lg shadow-sm transition-all flex gap-3 items-center`}
                >
                  <Pause size={20} fill="currentColor" /> Pause session
                </button>
                <button
                  onClick={handleEndSession}
                  className="hover:bg-red-50 border-2 border-red-200 text-red-600 font-bold py-4 px-10 rounded-full text-lg shadow-sm transition-all flex gap-3 items-center"
                >
                  <Square size={20} fill="currentColor" /> Finish early
                </button>
              </div>
            </>
          ) : sessionState === "paused" ? (
            <div className="flex flex-col items-center animate-pulse">
              <h1 className="text-7xl md:text-[12rem] leading-none font-[var(--font-display)] font-light text-violet-300 transition-colors drop-shadow-sm mb-4">
                PAUSED
              </h1>
              <p className="text-violet-400 font-bold tracking-widest text-sm uppercase mb-10">All tracking mechanisms suspended</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setSessionState("running")}
                  className="bg-violet-600 hover:bg-violet-700 text-white font-bold py-5 px-14 rounded-full text-xl transition-all flex gap-3 items-center shadow-xl shadow-violet-200"
                >
                  <Play size={24} fill="currentColor" /> Resume session
                </button>
                <button
                  onClick={handleEndSession}
                  className="border-2 border-red-200 text-red-500 hover:bg-red-50 font-bold py-5 px-10 rounded-full text-lg transition-all flex gap-3 items-center"
                >
                  <Square size={20} fill="currentColor" /> Finish session
                </button>
              </div>
            </div>
          ) : sessionState === "ended" ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full text-center flex flex-col justify-center flex-1 max-w-3xl">

              <div className="bg-white/60 backdrop-blur-xl p-8 md:p-12 rounded-3xl shadow-xl border border-white">
                <h2 className="text-4xl font-[var(--font-display)] text-violet-700 font-bold mb-8">Great job focusing.</h2>

                <div className="flex flex-col gap-6 mb-10 text-left w-full">
                  <div className="bg-violet-50/50 p-6 rounded-2xl border border-violet-100 flex items-center justify-between shadow-sm">
                    <div className="text-sm font-bold tracking-wider text-violet-500 uppercase">Focus Score</div>
                    <div className="text-5xl font-light font-[var(--font-display)] text-violet-900">
                      {Math.max(0, 100 - (tabSwitches * 5) - (Math.floor(awaySeconds / 10)))}
                      <span className="text-2xl text-violet-300 ml-1 font-normal">/100</span>
                    </div>
                  </div>
                  <div className="bg-violet-50/50 p-6 rounded-2xl border border-violet-100 flex flex-col justify-center shadow-sm">
                    <div className="text-sm font-bold tracking-wider text-violet-500 uppercase mb-3 border-b border-violet-100/50 pb-2">AI Summary</div>
                    <div className="text-base font-medium text-slate-700 leading-relaxed italic">
                      {currentFeedback ? currentFeedback : <span className="text-violet-300 animate-pulse">Analyzing routine...</span>}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSessionState("idle")}
                  className="bg-violet-600 hover:bg-violet-700 text-white font-bold py-4 px-10 rounded-full text-lg pill-button transition-all flex gap-2 w-max mx-auto items-center shadow-md shadow-violet-200"
                >
                  Start New Session
                </button>
              </div>
            </motion.div>
          ) : (
            <div className="w-full text-center flex flex-col items-center justify-center py-10 flex-1">
              <div className="mb-14">
                <h1 className="text-6xl md:text-[6rem] font-[var(--font-display)] text-transparent bg-clip-text bg-gradient-to-br from-violet-600 to-indigo-500 font-bold tracking-tight mb-4 drop-shadow-sm">
                  Blinkyoo
                </h1>
                <p className="text-violet-500/80 font-medium tracking-widest text-sm uppercase">
                  Uninterrupted focus. No history tracked.
                </p>
              </div>

              <div className="flex gap-2 mb-12 flex-wrap justify-center bg-white/40 p-1.5 rounded-full border border-white/60 shadow-inner scale-90 md:scale-100">
                {[10, 25, 50, 90].map(mins => (
                  <button
                    key={mins}
                    onClick={() => setSessionDurationMinutes(mins)}
                    className={`py-2 px-5 md:py-2.5 md:px-6 text-sm font-bold rounded-full transition-all ${sessionDurationMinutes === mins ? 'bg-white text-violet-700 shadow-sm' : 'text-violet-500/70 hover:bg-white/60'}`}
                  >
                    {mins}m
                  </button>
                ))}
              </div>

              <div className="flex flex-col items-center justify-center gap-3 w-full max-w-[28rem] mx-auto mb-10">
                <p className="text-violet-500/80 font-bold tracking-widest text-[10px] uppercase text-center bg-violet-100 px-4 py-2 rounded-full shadow-sm border border-violet-200">Native OS Screen Tracking</p>

                <div className="flex gap-2 w-full mt-2">
                  <input
                    type="text"
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (currentInput.trim() && !targetWebsites.includes(currentInput.trim())) {
                          setTargetWebsites([...targetWebsites, currentInput.trim()]);
                          setCurrentInput("");
                        }
                      }
                    }}
                    list="window-titles"
                    placeholder="Add allowed app or tab..."
                    className="w-full bg-white/40 border-2 border-white/60 focus:border-violet-300 focus:bg-white text-violet-700 placeholder-violet-300/60 rounded-xl px-5 py-3 outline-none font-medium shadow-inner transition-all sm:text-sm text-center"
                  />
                  <button
                    onClick={() => {
                      if (currentInput.trim() && !targetWebsites.includes(currentInput.trim())) {
                        setTargetWebsites([...targetWebsites, currentInput.trim()]);
                        setCurrentInput("");
                      }
                    }}
                    className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-6 py-3 rounded-xl transition-all shadow-md active:scale-95"
                  >
                    Add
                  </button>
                </div>

                <datalist id="window-titles">
                  {availableWindows
                    .filter(w => w && w.trim() !== "")
                    .map((w, i) => <option key={`${w}-${i}`} value={w} />)}
                </datalist>

                {targetWebsites.length > 0 && (
                  <div className="flex flex-wrap gap-2 w-full mt-2 justify-center">
                    {targetWebsites.map((target, i) => (
                      <div key={`${target}-${i}`} className="bg-violet-200/50 backdrop-blur-sm text-violet-700 border border-violet-300/50 text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2 shadow-sm animate-fade-in">
                        <span className="max-w-[200px] truncate">{target}</span>
                        <button onClick={() => setTargetWebsites(targetWebsites.filter(t => t !== target))} className="hover:text-red-500 hover:bg-white/50 rounded-full p-0.5 transition-all">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-[10px] text-violet-400 font-semibold px-4 text-center mt-2 leading-relaxed">Select from active windows or type a keyword. Add as many tabs/apps as you want!</div>
              </div>

              {/* Requirement Reminder for Chrome Users */}
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 rounded-2xl bg-violet-50/50 border border-violet-100/50 max-w-sm flex items-center gap-4 text-left shadow-sm"
              >
                <div className="p-2 bg-white rounded-xl shadow-sm">
                   <Activity className="text-violet-500" size={18} />
                </div>
                <div>
                   <p className="text-[11px] font-bold text-violet-600 uppercase tracking-widest mb-1">System Requirement</p>
                   <p className="text-[11px] text-violet-500/80 leading-snug">Ensure **Notifications** are enabled in your browser settings for real-time OS alerts to work properly.</p>
                </div>
              </motion.div>

              <button
                onClick={handleStartSession}
                className="mt-10 bg-violet-600 hover:bg-violet-700 text-white font-bold py-5 px-14 rounded-full text-2xl pill-button transition-all flex gap-3 items-center shadow-xl shadow-violet-200"
              >
                <Play size={24} fill="currentColor" /> Begin Focus
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="w-full md:w-[800px] flex flex-col gap-8">
        {/* Camera Feed Container */}
        <div className="h-full relative glass-panel rounded-3xl min-h-[300px] flex items-center justify-center p-4">
          {sessionState === "running" ? (
            <CameraFocus
              isActive={sessionState === "running"}
              onFaceMissing={() => {
                if (!isFaceMissing) {
                  setIsFaceMissing(true);
                  addNotification("We don't see you. Return to focus.", "warning");
                }
              }}
              onFaceFound={() => {
                if (isFaceMissing) {
                  setIsFaceMissing(false);
                  addNotification("You're back. Stay focused.", "info");
                }
              }}
              onPhoneDetected={() => {
                if (!isPhoneDetected) {
                  setIsPhoneDetected(true);
                  addNotification("Put the phone down. Focus on your task.", "danger");
                }
              }}
              onPhoneCleared={() => {
                if (isPhoneDetected) {
                  setIsPhoneDetected(false);
                  addNotification("Phone hidden. Good job.", "info");
                }
              }}
            />
          ) : (
            <div className="text-center flex flex-col items-center p-12 bg-violet-50/30 rounded-3xl w-full h-[calc(100%-2rem)] justify-center border border-dashed border-violet-200 relative overflow-hidden group">
              <div className="absolute inset-0 bg-violet-100/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <motion.img 
                src="/logo.png" 
                alt="Blinkyoo Logo" 
                className="w-32 h-32 md:w-48 md:h-48 object-contain opacity-40 grayscale-[0.5] contrast-[0.8] mb-6 select-none pointer-events-none"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 0.4 }}
                transition={{ duration: 1.5, repeat: Infinity, repeatType: 'reverse' }}
              />
              <span className="font-bold text-[10px] tracking-[0.2em] text-violet-400/60 uppercase">System Ready</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
