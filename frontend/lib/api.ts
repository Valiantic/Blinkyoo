import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const evaluateSession = async (
  data: { duration_minutes: number; tab_switches: number; away_seconds: number; focus_score: number }
) => {
  const response = await api.post(`/evaluate`, data);
  return response.data;
};
