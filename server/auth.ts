import type { Request, Response, NextFunction, Express } from "express";
import { lucia } from "./lucia";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { generateId } from "lucia";
import bcrypt from "bcryptjs";
import { z } from "zod";

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? "");

  if (!sessionId) {
    res.locals.user = null;
    res.locals.session = null;
    return next();
  }

  const { session, user } = await lucia.validateSession(sessionId);

  if (session && session.fresh) {
    res.appendHeader("Set-Cookie", lucia.createSessionCookie(session.id).serialize());
  }

  if (!session) {
    res.appendHeader("Set-Cookie", lucia.createBlankSessionCookie().serialize());
  }

  res.locals.user = user;
  res.locals.session = session;
  next();
}

export const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (!res.locals.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const parsed = signupSchema.parse(req.body);

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, parsed.email));

      if (existing) {
        return res.status(400).json({ message: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(parsed.password, 10);
      const userId = generateId(15);

      await db.insert(users).values({
        id: userId,
        email: parsed.email,
        passwordHash,
        firstName: parsed.firstName || null,
        lastName: parsed.lastName || null,
      });

      const session = await lucia.createSession(userId, {});
      res.appendHeader("Set-Cookie", lucia.createSessionCookie(session.id).serialize());

      const [user] = await db.select().from(users).where(eq(users.id, userId));
      res.status(201).json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Signup error:", err);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.parse(req.body);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, parsed.email));

      if (!user) {
        return res.status(400).json({ message: "Invalid email or password" });
      }

      const validPassword = await bcrypt.compare(parsed.password, user.passwordHash);
      if (!validPassword) {
        return res.status(400).json({ message: "Invalid email or password" });
      }

      const session = await lucia.createSession(user.id, {});
      res.appendHeader("Set-Cookie", lucia.createSessionCookie(session.id).serialize());

      res.json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      console.error("Login error:", err);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (!res.locals.session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await lucia.invalidateSession(res.locals.session.id);
    res.appendHeader("Set-Cookie", lucia.createBlankSessionCookie().serialize());
    res.json({ success: true });
  });

  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    const user = res.locals.user!;
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    });
  });
}
