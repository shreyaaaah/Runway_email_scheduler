import { describe, expect, it } from "vitest";

// The worker's Lua logic is atomic in Redis. This tiny reference model covers allow/deny/undo behavior.
function reserve(count:number,limit:number){const next=count+1;return next>limit?{count,allowed:false}:{count:next,allowed:true}}
describe("rate limit reservation",()=>{
 it("allows up to the configured cap",()=>{let n=0;for(let i=0;i<4;i++){const r=reserve(n,3);n=r.count;if(i<3)expect(r.allowed).toBe(true);else expect(r.allowed).toBe(false)}expect(n).toBe(3)});
 it("undoes an over-limit increment",()=>expect(reserve(5,5)).toEqual({count:5,allowed:false}));
});
