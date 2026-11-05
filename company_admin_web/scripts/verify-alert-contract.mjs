// 명시적 Node 실행 파일입니다. Vitest 자동 수집 이름을 사용하지 않습니다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiAlertRepository, parseAlert, apiAlertStatusLabel } from "../src/data/alertRepository.ts";

const row = {
  alert_id:101,device_id:1,device_code:"DB-1",store_id:1,store_name:"DB 매장",
  alert_type:"NEW_TYPE",severity:"NEW_SEVERITY",message:"원본 메시지",alert_status:"NEW_STATUS",
  occurred_at:"2026-10-27T00:00:00+00:00",acknowledged_at:null,acknowledged_by:null,
  acknowledged_by_name:null,resolved_at:null,
};
test("원본 문자열과 NULL, 확인·해소의 독립성을 보존한다",()=>{
  const result=parseAlert(row);
  assert.equal(result.alert_status,"NEW_STATUS");
  assert.equal(result.acknowledged_at,null);
  const resolved=parseAlert({...row,resolved_at:"2026-10-27T09:00:00+09:00"});
  assert.equal(resolved.acknowledged_at,null);
  assert.equal(new Date(resolved.resolved_at).getTime(),new Date(row.occurred_at).getTime());
  assert.equal(apiAlertStatusLabel("NEW_STATUS"),"NEW_STATUS");
  assert.equal(apiAlertStatusLabel("UNREAD"),"읽지 않음 (UNREAD)");
});
test("잘못된 식별자·누락·오프셋 없는 날짜를 거부하고 추가 필드는 복사하지 않는다",()=>{
  for(const patch of [{alert_id:"101"},{alert_type:undefined},{acknowledged_by:0},
    {occurred_at:"2026-10-27T00:00:00"},{resolved_at:"invalid"}])
    assert.throws(()=>parseAlert({...row,...patch}));
  assert.equal("private_field" in parseAlert({...row,private_field:"fixture-secret"}),false);
});
test("빈 목록·목록·상세를 GET만으로 조회한다",async()=>{
  const calls=[],payloads=[{alerts:[],total:0},{alerts:[row],total:1},row];
  const repository=new ApiAlertRepository("http://localhost:8001/base/",async(url,init)=>{
    calls.push({url,init});return new Response(JSON.stringify(payloads.shift()));
  });
  assert.deepEqual(await repository.load(),[]);
  assert.equal((await repository.load())[0].alert_id,101);
  assert.equal((await repository.detail(101)).device_id,1);
  assert.equal(calls[0].url,"http://localhost:8001/base/admin/alerts");
  assert.equal(calls[2].url,"http://localhost:8001/base/admin/alerts/101");
  assert(calls.every(({init})=>init.method==="GET"));
});
test("HTTP 실패·중복·건수 불일치·상세 ID 불일치를 거부한다",async()=>{
  for(const status of [403,404,503]){
    const repository=new ApiAlertRepository("http://localhost:8001",async()=>new Response("",{status}));
    await assert.rejects(repository.load());await assert.rejects(repository.detail(101));
  }
  for(const data of [{alerts:[row],total:2},{alerts:[row,row],total:2}])
    await assert.rejects(new ApiAlertRepository("http://localhost:8001",async()=>new Response(JSON.stringify(data))).load());
  await assert.rejects(new ApiAlertRepository("http://localhost:8001",async()=>new Response(JSON.stringify(row))).detail(102));
});
test("잘못된 주소와 ID는 요청 전에 거부한다",async()=>{
  let calls=0;const transport=async()=>{calls++;throw new Error("unexpected");};
  for(const url of ["file:///private","http://user:secret@localhost:8001"])
    await assert.rejects(new ApiAlertRepository(url,transport).load(),/알림 API 주소/);
  await assert.rejects(new ApiAlertRepository("http://localhost:8001",transport).detail(0));
  assert.equal(calls,0);
});
test("취소와 타임아웃을 전파한다",async()=>{
  const transport=async(_url,init)=>new Promise((_resolve,reject)=>{
    if(init.signal.aborted)reject(new Error("aborted"));
    else init.signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});
  });
  const controller=new AbortController();
  const request=new ApiAlertRepository("http://localhost:8001",transport).load(controller.signal);
  controller.abort();await assert.rejects(request,/aborted/);
  await assert.rejects(new ApiAlertRepository("http://localhost:8001",transport,5).load(),/aborted/);
});
