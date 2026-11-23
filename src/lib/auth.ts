
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is missing from environment variables");
}

// Password securely hash করা
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Password verify করা
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// JWT Token তৈরি করা
export function generateToken(payload: {
  userId: string;
  email: string;
  role: string;
}): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "1d",
  });
}

// JWT Token verify করা
export function verifyToken(token: string) {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.verify(token, JWT_SECRET);
}
