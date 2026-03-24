"use client";
import { useEffect, useRef, useState } from "react";
// @ts-ignore
import { FaceLandmarker, ObjectDetector, HandLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import { CameraOff } from "lucide-react";

interface Props {
  isActive: boolean;
  onFaceMissing: () => void;
  onFaceFound: () => void;
  onPhoneDetected: () => void;
  onPhoneCleared: () => void;
}

export default function CameraFocus({ isActive, onFaceMissing, onFaceFound, onPhoneDetected, onPhoneCleared }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [faceLandmarker, setFaceLandmarker] = useState<FaceLandmarker | null>(null);
  const [objectDetector, setObjectDetector] = useState<ObjectDetector | null>(null);
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  
  const [cameraAccess, setCameraAccess] = useState<boolean | null>(null);
  const requestRef = useRef<number>(0);
  
  const consecutiveMissingFrames = useRef<number>(0);
  const consecutivePhoneFrames = useRef<number>(0);
  
  const lastVideoTime = useRef<number>(-1);

  // Initialize both models
  useEffect(() => {
    // Monkey-patch console.error to suppress harmless MediaPipe INFO logs 
    // that crash the Next.js dev overlay
    const originalError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] && typeof args[0] === 'string' && args[0].includes('TensorFlow Lite XNNPACK delegate for CPU')) {
        return; // Suppress INFO logs incorrectly logged as errors by WASM
      }
      originalError(...args);
    };

    let active = true;
    const initializeModels = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        
        const fLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "CPU"
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 1
        });
        
        const oDetector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite",
            delegate: "CPU"
          },
          scoreThreshold: 0.5,
          runningMode: "VIDEO",
        });
        
        const hLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numHands: 2
        });
        
        if (active) {
          setFaceLandmarker(fLandmarker);
          setObjectDetector(oDetector);
          setHandLandmarker(hLandmarker);
        }
      } catch (err) {
        // Failed to load MediaPipe models
      }
    };
    initializeModels();
    
    return () => { 
      active = false; 
      console.error = originalError; // Restore
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    let active = true;
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
      .then(stream => {
        if (!active) return stream.getTracks().forEach(t => t.stop());
        setCameraAccess(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(err => {
        setCameraAccess(false);
      });

    return () => {
      active = false;
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [isActive]);

  const predictWebcam = () => {
    if (!videoRef.current || !canvasRef.current || !faceLandmarker || !objectDetector || !handLandmarker || !isActive) return;

    if (videoRef.current.readyState >= 2) {
      const nowInMs = performance.now();
      const videoWidth = videoRef.current.videoWidth;
      const videoHeight = videoRef.current.videoHeight;

      // Make sure canvas matches video dimensions
      if (canvasRef.current.width !== videoWidth) {
        canvasRef.current.width = videoWidth;
        canvasRef.current.height = videoHeight;
      }
      
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;
      
      let faceMissingThisFrame = true;
      let phoneDetectedThisFrame = false;

      // Only attempt prediction if the video has moved forward or in a new frame loop
      if (videoRef.current.currentTime !== lastVideoTime.current) {
        lastVideoTime.current = videoRef.current.currentTime;
        
        // Clear canvas
        ctx.clearRect(0, 0, videoWidth, videoHeight);
        const drawingUtils = new DrawingUtils(ctx);
        
        // 1. Face Landmarker Logic
        const faceResults = faceLandmarker.detectForVideo(videoRef.current, nowInMs);
        if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
          faceMissingThisFrame = false;
          // Draw face mesh
          for (const landmarks of faceResults.faceLandmarks) {
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
              color: "#C084FC", // Violet-400
              lineWidth: 1
            });
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#ffffff", lineWidth: 2 });
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#ffffff", lineWidth: 2 });
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: "#E879F9", lineWidth: 2 }); // Fuchsia
          }
        }
        
        // 2. Object Logic (Phone / Distractions)
        const objectResults = objectDetector.detectForVideo(videoRef.current, nowInMs);
        
        for (const detection of objectResults.detections) {
           const label = detection.categories[0].categoryName;
           // We flag distractions. Let's flag common ones: cell phone, cup, book.
           if (label === "cell phone" || label === "book" || label === "cup") {
             phoneDetectedThisFrame = true;
           }
           
           // Draw bounding box for all detected items
           const box = detection.boundingBox;
           if (box) {
             const isCell = label === "cell phone";
             ctx.strokeStyle = isCell ? "#EF4444" : "#FBBF24"; // Red for phone, yellow for other objects
             ctx.lineWidth = 3;
             ctx.strokeRect(box.originX, box.originY, box.width, box.height);
             
             ctx.fillStyle = isCell ? "#EF4444" : "#FBBF24";
             ctx.font = "bold 16px Arial";
             ctx.fillText(
               `${label} - ${Math.round(detection.categories[0].score * 100)}%`,
               box.originX,
               box.originY - 10
             );
           }
        }
        
        // 3. Hand Landmarker Logic
        const handResults = handLandmarker.detectForVideo(videoRef.current, nowInMs);
        if (handResults.landmarks) {
          for (const landmarks of handResults.landmarks) {
            drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
              color: "#C084FC", // Violet-400
              lineWidth: 1
            });
            drawingUtils.drawLandmarks(landmarks, { color: "#E879F9", lineWidth: 1, radius: 2 }); // Fuchsia
          }
        }
      }

      // Handle continuous states
      if (faceMissingThisFrame) {
        consecutiveMissingFrames.current++;
        if (consecutiveMissingFrames.current > 30) onFaceMissing();
      } else {
        if (consecutiveMissingFrames.current > 30) onFaceFound();
        consecutiveMissingFrames.current = 0;
      }
      
      if (phoneDetectedThisFrame) {
        consecutivePhoneFrames.current++;
        if (consecutivePhoneFrames.current > 15) onPhoneDetected();
      } else {
        if (consecutivePhoneFrames.current > 15) onPhoneCleared();
        consecutivePhoneFrames.current = 0;
      }
    }
    
    if (isActive) {
        requestRef.current = requestAnimationFrame(predictWebcam);
    }
  };

  useEffect(() => {
    if (faceLandmarker && objectDetector && handLandmarker && isActive && cameraAccess) {
      const timeout = setTimeout(() => {
        predictWebcam();
      }, 1000);
      return () => clearTimeout(timeout);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [faceLandmarker, objectDetector, handLandmarker, isActive, cameraAccess]);

  if (!isActive) return null;

  return (
    <div className="relative w-full h-full min-h-[260px] rounded-3xl overflow-hidden glass-panel-violet flex flex-col items-center justify-center p-2 shadow-inner">
      {cameraAccess === false ? (
        <div className="flex flex-col items-center justify-center text-violet-400 p-6 text-center">
          <CameraOff size={48} className="mb-4 opacity-50 text-red-400" />
          <p className="text-sm font-medium">Camera access denied.</p>
          <p className="text-xs mt-2 opacity-60">Please check browser permissions.</p>
        </div>
      ) : (
        <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-lg border border-violet-100/20 bg-violet-900/10 backdrop-blur-sm flex items-center justify-center">
           <video
             ref={videoRef}
             className="w-full h-full object-cover filter contrast-[1.05] brightness-105 saturate-75 mix-blend-multiply"
             autoPlay
             playsInline
             muted
           ></video>
           <canvas
             ref={canvasRef}
             className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none"
           ></canvas>
           
           <div className="absolute top-4 left-4 flex gap-2">
              <div className="flex items-center gap-2 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full shadow-sm text-xs font-semibold text-violet-700 tracking-wide uppercase">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                MAPPER ACTIVE
              </div>
           </div>
           
           {(!faceLandmarker || !objectDetector || !handLandmarker) && cameraAccess === true && (
             <div className="absolute inset-0 flex items-center justify-center bg-violet-50/50 backdrop-blur-md">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full border-4 border-violet-300 border-t-violet-600 animate-spin mb-4"></div>
                  <span className="text-sm font-semibold text-violet-900 tracking-wider">LOADING NEURAL MESH</span>
                </div>
             </div>
           )}
        </div>
      )}
    </div>
  );
}
