import "dotenv/config";
import { db } from "../src/db.js";
import { planSchedule } from "../src/schedule.js";

// Print a representative plan without sending messages; pass --persist to insert the campaign.
const user=await db.user.findFirst({include:{senders:true}});
if(!user||!user.senders.length)throw new Error("Create a user with an Ethereal sender before running the load test");
const leads=Array.from({length:1200},(_,i)=>`load-${i}@example.test`);
const startAt=new Date(Date.now()+60_000);const plan=planSchedule({leads,senders:user.senders,startAt,delayMs:Number(process.env.MIN_DELAY_MS_BETWEEN_SENDS??1000),hourlyLimit:Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER??100)});
const buckets=new Map<string,number>();for(const item of plan){const h=new Date(item.scheduledAt);h.setMinutes(0,0,0);const k=h.toISOString();buckets.set(k,(buckets.get(k)??0)+1)}
console.log(`Planned ${plan.length} emails from ${startAt.toISOString()}`);for(const [hour,count] of buckets)console.log(`${hour}: ${count}`);
if(process.argv.includes("--persist"))console.log("--persist is reserved; use POST /api/campaigns to persist and queue deliveries.");
await db.$disconnect();
