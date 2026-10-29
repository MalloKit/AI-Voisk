import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiAlertRepository, apiAlertStatusLabel } from "../data/alertRepository";

const raw=(id=101)=>({alert_id:id,device_id:7,device_code:"REAL-7",store_id:99,store_name:"실제 전용 매장",
  alert_type:"CUSTOM",severity:"HIGH",message:"알림 내용",alert_status:"UNREAD",occurred_at:"2026-10-29T00:00:00+00:00",
  acknowledged_at:null as string|null,acknowledged_by:null as number|null,acknowledged_by_name:null as string|null,resolved_at:"2026-10-29T00:01:00+00:00"});
function fixture() {
  const rows=[raw(),raw(102)];const requests:{path:string;method:string;body?:unknown}[]=[];
  const other=()=>({load:vi.fn().mockResolvedValue([]),detail:vi.fn()});
  const order=other(),store=other(),owner=other(),device=other();
  let writeFailure=0,listFailure=false,detailFailure=false,hold:Promise<Response>|undefined;
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
  const http=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
    const path=new URL(String(input)).pathname,method=init?.method??"GET";
    requests.push({path,method,body:init?.body?JSON.parse(String(init.body)):undefined});
    if(path==="/auth/admin/csrf")return json({csrf_token:"c".repeat(43)});
    if(path==="/admin/alerts")return listFailure?json({},503):json({alerts:rows,total:rows.length});
    const row=rows.find(a=>a.alert_id===Number(path.split("/")[3]))!;
    if(method==="PATCH") {
      if(writeFailure)return json({detail:"private-error-canary"},writeFailure);
      if(hold)return hold;
      if(row.alert_status!=="UNREAD")return json({},409);
      row.alert_status="ACKNOWLEDGED";row.acknowledged_at="2026-10-29T00:02:00+00:00";row.acknowledged_by=1;row.acknowledged_by_name="현재 관리자";
    } else if(detailFailure)return json({},503);
    return json(row);
  });
  return{rows,requests,http,json,order,store,owner,device,repo:new ApiAlertRepository("http://localhost:8001",http),
    failWrite:(value:number)=>{writeFailure=value;},failList:(value:boolean)=>{listFailure=value;},failDetail:(value:boolean)=>{detailFailure=value;},hold:(value:Promise<Response>)=>{hold=value;}};
}
const nav=(name:string)=>within(screen.getByRole("navigation",{name:"주요 화면"})).getByRole("button",{name});
async function open(f=fixture(),mock=false) {
 const admin=new MockAdminRepository();const mockAck=vi.spyOn(admin,"acknowledgeAlert");
 render(<App repository={admin} orderRepository={f.order} storeRepository={f.store} ownerRepository={f.owner} deviceRepository={f.device} alertRepository={mock?null:f.repo}/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"전체 새로고침"})).toBeEnabled());
 const user=userEvent.setup();await user.click(nav("장애/알림"));return{user,mockAck};
}
const dialog=()=>within(screen.getByRole("dialog"));
async function detail(user:ReturnType<typeof userEvent.setup>) {
 await user.click(screen.getByRole("button",{name:"알림 상세: #101"}));await dialog().findByText("실제 전용 매장 (ID: 99)");
}
const writes=(f:ReturnType<typeof fixture>)=>f.requests.filter(r=>r.method==="PATCH");

describe("actual alert acknowledgement",()=>{
 it("explains only the agreed states and preserves unknown strings",()=>{
  expect(apiAlertStatusLabel("ACKNOWLEDGED")).toBe("확인 완료 (ACKNOWLEDGED)");expect(apiAlertStatusLabel("UNREAD")).toBe("읽지 않음 (UNREAD)");
  for(const value of ["READ","RESOLVED","FUTURE","unread"])expect(apiAlertStatusLabel(value)).toBe(value);
 });
 it("acknowledges real detail, preserves resolution and refreshes list/dashboard without unrelated reads",async()=>{
  const f=fixture(),{user,mockAck}=await open(f);await detail(user);
  expect(dialog().getByText("확인 완료는 관리자가 알림을 검토했다는 의미이며, 실제 장애 해결을 의미하지 않습니다.")).toBeInTheDocument();
  await user.click(dialog().getByRole("button",{name:"확인 완료"}));
  await dialog().findByText("현재 관리자 (ID: 1)");expect(dialog().getByText("ACKNOWLEDGED")).toBeInTheDocument();
  expect(dialog().queryByRole("button",{name:"확인 완료"})).not.toBeInTheDocument();
  expect(f.rows[0].resolved_at).toBe("2026-10-29T00:01:00+00:00");expect(writes(f)[0].body).toEqual({expected_status:"UNREAD"});
  await user.click(dialog().getByRole("button",{name:"닫기"}));expect(screen.getByRole("table")).toHaveTextContent("확인 완료 (ACKNOWLEDGED)");
  await user.click(nav("운영 요약"));expect(screen.getByLabelText("미열람 알림")).toHaveTextContent("1건");
  for(const repo of [f.order,f.store,f.owner,f.device])expect(repo.load).toHaveBeenCalledTimes(1);
  expect(f.requests.filter(r=>r.path==="/admin/alerts")).toHaveLength(2);expect(mockAck).not.toHaveBeenCalled();
 });
 it.each(["ACKNOWLEDGED","READ","RESOLVED","FUTURE"])("does not offer acknowledgement for %s",async(status)=>{
  const f=fixture();f.rows[0].alert_status=status;if(status==="ACKNOWLEDGED"){f.rows[0].acknowledged_at="2026-10-29T00:02:00+00:00";f.rows[0].acknowledged_by=2;}
  const {user}=await open(f);await detail(user);expect(dialog().queryByRole("button",{name:"확인 완료"})).not.toBeInTheDocument();expect(writes(f)).toHaveLength(0);
 });
 it.each(["time","admin"])("does not offer acknowledgement for inconsistent UNREAD %s",async(field)=>{
  const f=fixture();if(field==="time")f.rows[0].acknowledged_at="2026-10-29T00:02:00+00:00";else f.rows[0].acknowledged_by=2;
  const {user}=await open(f);await detail(user);expect(dialog().queryByRole("button",{name:"확인 완료"})).not.toBeInTheDocument();
 });
 it("keeps search and state filters after successful acknowledgement",async()=>{
  const f=fixture(),{user}=await open(f);await user.type(screen.getByRole("textbox"),"101");
  await user.selectOptions(screen.getByLabelText("DB 원본 상태"),JSON.stringify("UNREAD"));await detail(user);
  await user.click(dialog().getByRole("button",{name:"확인 완료"}));await dialog().findByText("현재 관리자 (ID: 1)");
  await user.click(dialog().getByRole("button",{name:"닫기"}));expect(screen.getByText("알림 목록 · 0건")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("101");expect(screen.getByLabelText("DB 원본 상태")).toHaveValue(JSON.stringify("UNREAD"));
  await user.click(screen.getByRole("button",{name:"초기화"}));expect(screen.getByText("알림 목록 · 2건")).toBeInTheDocument();
 });
 it("blocks repeated clicks and modal closing until the request finishes",async()=>{
  const f=fixture(),{user}=await open(f);let resolve!:(value:Response)=>void;const held=new Promise<Response>(r=>{resolve=r;});f.hold(held);
  await detail(user);const button=dialog().getByRole("button",{name:"확인 완료"});await user.dblClick(button);
  await waitFor(()=>expect(writes(f)).toHaveLength(1));expect(dialog().getByRole("button",{name:"닫기"})).toBeDisabled();
  await user.keyboard("{Escape}");expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async()=>resolve(f.json({},503)));await dialog().findByRole("alert");expect(f.rows[0].alert_status).toBe("UNREAD");
 });
 it("stops stale resubmission on conflict and reloads the actual first confirmation",async()=>{
  const f=fixture(),{user,mockAck}=await open(f);await detail(user);f.failWrite(409);
  await user.click(dialog().getByRole("button",{name:"확인 완료"}));await dialog().findByRole("alert");
  expect(dialog().getByRole("button",{name:"확인 완료"})).toBeDisabled();
  f.rows[0].alert_status="ACKNOWLEDGED";f.rows[0].acknowledged_by=2;f.rows[0].acknowledged_at="2026-10-29T00:02:00+00:00";
  await user.click(dialog().getByRole("button",{name:"상세 다시 조회"}));await dialog().findByText("이름 정보 없음 (ID: 2)");
  expect(dialog().queryByRole("button",{name:"확인 완료"})).not.toBeInTheDocument();expect(writes(f)).toHaveLength(1);expect(mockAck).not.toHaveBeenCalled();
 });
 it.each([422,503])("does not report success or expose server details on %i",async(status)=>{
  const f=fixture();f.failWrite(status);const {user,mockAck}=await open(f);await detail(user);await user.click(dialog().getByRole("button",{name:"확인 완료"}));
  await dialog().findByRole("alert");expect(screen.queryByText("private-error-canary")).not.toBeInTheDocument();expect(f.rows[0].alert_status).toBe("UNREAD");
  expect(screen.queryByText(/확인 저장이 완료/)).not.toBeInTheDocument();expect(mockAck).not.toHaveBeenCalled();
 });
 it("separates successful save from failed list reload and dashboard error until retry",async()=>{
  const f=fixture(),{user}=await open(f);await detail(user);f.failList(true);
  await user.click(dialog().getByRole("button",{name:"확인 완료"}));await dialog().findByText("현재 관리자 (ID: 1)");
  await screen.findByText(/확인 저장은 완료됐지만 알림 목록 재조회에 실패/);
  await user.click(dialog().getByRole("button",{name:"닫기"}));await user.click(nav("운영 요약"));expect(screen.getByLabelText("미열람 알림")).toHaveTextContent("조회 실패");
  f.failList(false);await user.click(screen.getByRole("button",{name:"다시 시도"}));await waitFor(()=>expect(screen.getByLabelText("미열람 알림")).toHaveTextContent("1건"));
 });
 it("separates successful save from failed detail refresh",async()=>{
  const f=fixture(),{user}=await open(f);await detail(user);f.failDetail(true);
  await user.click(dialog().getByRole("button",{name:"확인 완료"}));await dialog().findByText("확인 저장은 완료됐지만 상세 재조회에 실패했습니다.");
  expect(dialog().getByText(/확인 저장이 완료/)).toBeInTheDocument();f.failDetail(false);
  await user.click(dialog().getByRole("button",{name:"다시 시도"}));await dialog().findByText("현재 관리자 (ID: 1)");expect(writes(f)).toHaveLength(1);
 });
 it("preserves explicit Mock acknowledgement without making actual write requests",async()=>{
  const f=fixture(),{user,mockAck}=await open(f,true);
  const buttons=screen.getAllByRole("button",{name:/알림 상세:/});
  for(const button of buttons){await user.click(button);const ack=dialog().queryByRole("button",{name:"확인 완료로 표시"});if(ack){await user.click(ack);break;}await user.click(dialog().getByRole("button",{name:"닫기"}));}
  expect(mockAck).toHaveBeenCalledTimes(1);expect(writes(f)).toHaveLength(0);
 });
 it("uses only expected status, CSRF and credentials and rejects mismatched saved responses",async()=>{
  const f=fixture();await f.repo.acknowledge(101);expect(writes(f)[0].body).toEqual({expected_status:"UNREAD"});
  for(const [,init] of f.http.mock.calls){expect(init?.credentials).toBe("include");expect(init?.cache).toBe("no-store");}
  expect(f.http.mock.calls.find(([,init])=>init?.method==="PATCH")![1]!.headers).toHaveProperty("X-CSRF-Token");
  const count=f.requests.length;await expect(f.repo.acknowledge(0)).rejects.toThrow();expect(f.requests).toHaveLength(count);
  for(const response of [{...raw(999),alert_status:"ACKNOWLEDGED",acknowledged_by:1,acknowledged_at:"2026-10-29T00:02:00+00:00"},raw()]){
   const repo=new ApiAlertRepository("http://localhost:8001",vi.fn<typeof fetch>().mockResolvedValueOnce(f.json({csrf_token:"c".repeat(43)})).mockResolvedValueOnce(f.json(response)));
   await expect(repo.acknowledge(101)).rejects.toThrow();
  }
 });
});
