import "dotenv/config";
import nodemailer from "nodemailer";
import { PrismaClient } from "@prisma/client";
const db=new PrismaClient();
const email = process.env.SEED_EMAIL ?? "demo@example.com";
const user = await db.user.upsert({ where: { email }, update: {}, create: { email, name: "Demo User" } });
if (!(await db.sender.count({ where: { userId: user.id } }))) {
  const account = await nodemailer.createTestAccount();
  await db.sender.create({
    data: {
      userId: user.id,
      email: account.user,
      name: user.name,
      smtpHost: account.smtp.host,
      smtpPort: account.smtp.port,
      smtpUser: account.user,
      smtpPass: account.pass,
    },
  });
}
console.log(`Seeded ${user.email} with an Ethereal sender. Configure Google OAuth to sign in as this user.`);
await db.$disconnect();
