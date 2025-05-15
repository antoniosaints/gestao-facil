import axios from "axios";
import { env } from "../utils/dotenv";

export const httpAsaas = axios.create({
  baseURL: 'https://sandbox.asaas.com/api/v3',
  headers: {
    'Content-Type': 'application/json',
    'access_token': env.ASAAS_API_KEY || ''
  }
});
