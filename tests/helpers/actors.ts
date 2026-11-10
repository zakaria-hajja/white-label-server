import { decodeJwt } from "jose";
import { envelope } from "./http";
import { testPrisma } from "./db";
import { loadConfig } from "@/core/config/env";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { seed, SEED_PASSWORD } from "../../prisma/seed-data";

export type TenantActors = {
  id: string;
  slug: string;
  aliceId: string;
  bobId: string;
  catalogIds: string[];
};
export type Login = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  sessionId: string;
};

/** Seeds acme and globex (shared mode): same emails, same catalog titles, different rows. */
export async function seedTwoTenants(): Promise<{ acme: TenantActors; globex: TenantActors }> {
  const prisma = testPrisma();
  await seed(prisma, loadConfig(process.env));
  const load = async (slug: string): Promise<TenantActors> => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
    const users = await prisma.user.findMany({ where: { tenantId: tenant.id } });
    const items = await prisma.catalogItem.findMany({ where: { tenantId: tenant.id } });
    const idOf = (email: string) => users.find((u) => u.email === email)?.id ?? "";
    return {
      id: tenant.id,
      slug,
      aliceId: idOf("alice@shared.test"),
      bobId: idOf("bob@shared.test"),
      catalogIds: items.map((i) => i.id),
    };
  };
  return { acme: await load("acme"), globex: await load("globex") };
}

/** Logs in through the real login route, so the tokens and the session are real. */
export async function loginAs(tenantSlug: string, email: string): Promise<Login> {
  const res = await login(
    new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: SEED_PASSWORD }),
      headers: { "content-type": "application/json", "x-client-id": tenantSlug },
    }),
    { params: Promise.resolve({}) },
  );
  if (res.status !== 200) throw new Error(`loginAs(${tenantSlug}, ${email}) -> ${res.status}`);
  const data = (await envelope(res)).data as {
    tokens: { accessToken: string; refreshToken: string };
    user: { id: string };
  };
  const { accessToken, refreshToken } = data.tokens;
  return {
    accessToken,
    refreshToken,
    userId: data.user.id,
    sessionId: String(decodeJwt(accessToken).sid),
  };
}
