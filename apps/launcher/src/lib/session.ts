import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionSecret } from "./env";

export interface SessionData {
  /** SIWE nonce issued to this visitor, consumed on verify. */
  nonce?: string;
  /** Set only after a successful SIWE verification. */
  address?: `0x${string}`;
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), {
    password: sessionSecret(),
    cookieName: "freeshop_session",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  });
}

/** The signed-in merchant address, or undefined. */
export async function sessionAddress(): Promise<`0x${string}` | undefined> {
  const session = await getSession();
  return session.address;
}
