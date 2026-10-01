import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  env: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret-change-me'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '365', 10),

  store: {
    lat: parseFloat(process.env.STORE_LAT || '24.580164'),
    lng: parseFloat(process.env.STORE_LNG || '84.114194'),
    pincode: process.env.SERVICEABLE_PINCODE || '824301',
  },

  osrmUrl: process.env.OSRM_URL || 'https://router.project-osrm.org',

  mail: {
    host: process.env.MAIL_HOST || '',
    port: parseInt(process.env.MAIL_PORT || '587', 10),
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || '4A Store',
  },

  fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT || '',
};
