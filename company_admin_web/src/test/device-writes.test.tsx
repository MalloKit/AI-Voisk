import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { MockAdminRepository } from "../data/adminRepository";
import { ApiDeviceRepository, validDeviceCode } from "../data/deviceRepository";
import { ApiStoreRepository } from "../data/storeRepository";

const raw = (id = 7, active = true, store = 1, code = "Existing-7") => ({ device_id:id, device_code:code, store_id:store,
  store_name:"실제 매장 " + store, store_address:"부산", store_address_detail:null, is_active:active,
  registered_at:"2026-10-29T00:00:00+00:00", app_version:null, last_seen_at:null, last_synced_at:null });
function fixture() {
  const devices=[raw()];
  const stores=[1,2].map((id)=>({store_id:id,store_name:"실제 매장 "+id,address:"부산",address_detail:null,
    store_code:"T0001",phone:"legacy",business_no:"legacy",representative:"대표",store_type:"카페",admin_id:1,admin_name:"관리자",owner_id:null,owner_login_id:null}));
  const requests:{path:string; method:string; body?:Record<string,unknown>}[]=[];
  const other = () => ({load:vi.fn().mockResolvedValue([]), detail:vi.fn()});
  const order=other(),owner=other(),alert=other();
  let failure=0, storeFailure=false, hold:Promise<Response>|undefined;
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
  const http=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
    const path=new URL(String(input)).pathname,method=init?.method??"GET";
    const body=init?.body?JSON.parse(String(init.body)):undefined; requests.push({path,method,body});
    if(path==="/auth/admin/csrf")return json({csrf_token:"c".repeat(43)});
    if(method!=="GET") {
      if(failure)return json({detail:"private-error-canary"},failure);
      if(hold)return hold;
      if(method==="POST") {
        if(devices.some(d=>d.device_code.toLowerCase()===body.device_code.toLowerCase()))return json({},409);
        const row=raw(devices.length+7,false,body.store_id,body.device_code);devices.push(row);return json(row,201);
      }
      const row=devices.find(d=>d.device_id===Number(path.split("/")[3]))!;
      if(row.is_active!==body.expected_is_active)return json({},409);
      row.is_active=body.is_active;return json(row);
    }
    if(path==="/admin/stores")return storeFailure?json({},503):json({stores,total:stores.length});
    if(path==="/admin/devices")return json({devices,total:devices.length});
    return json(devices.find(d=>d.device_id===Number(path.split("/")[3])));
  });
  return {devices,stores,requests,http,json,order,owner,alert,
    repo:new ApiDeviceRepository("http://localhost:8001",http), storesRepo:new ApiStoreRepository("http://localhost:8001",http),
    fail:(status:number)=>{failure=status;},failStores:(value:boolean)=>{storeFailure=value;},hold:(p:Promise<Response>)=>{hold=p;}};
}
const nav=(name:string)=>within(screen.getByRole("navigation",{name:"주요 화면"})).getByRole("button",{name});
async function open(f=fixture(),mockStores=false,mockDevices=false) {
  render(<App repository={new MockAdminRepository()} orderRepository={f.order} ownerRepository={f.owner} alertRepository={f.alert}
    storeRepository={mockStores?null:f.storesRepo} deviceRepository={mockDevices?null:f.repo}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"전체 새로고침"})).toBeEnabled());
  const user=userEvent.setup();await user.click(nav("기기 관리"));return user;
}
const modal=()=>within(screen.getByRole("dialog"));
async function createForm(user:ReturnType<typeof userEvent.setup>,code="New-002") {
  await user.click(screen.getByRole("button",{name:"기기 등록"}));
  await user.type(modal().getByRole("textbox",{name:"기기 코드"}),code);
  await user.selectOptions(modal().getByLabelText("설치 매장"),"2");
}
async function statusForm(user:ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button",{name:"기기 상세: Existing-7"}));
  await user.click(await modal().findByRole("button",{name:"비활성화"}));
}
const writeCalls=(f:ReturnType<typeof fixture>)=>f.requests.filter(r=>r.method!=="GET");
const deferred=()=>{let resolve!:(r:Response)=>void;const promise=new Promise<Response>(r=>{resolve=r;});return{resolve,promise};};

describe("device registration and activation writes",()=>{
  it("validates exact code boundaries without case normalization or whitespace",()=>{
    for(const value of ["x","A".repeat(50),"MiXeD_-09"])expect(validDeviceCode(value)).toBe(true);
    for(const value of ["","a".repeat(51)," x","x ","x\n","한글","x.y"])expect(validDeviceCode(value)).toBe(false);
  });
  it("requires valid code and a real store before submitting",async()=>{
    const f=fixture(),user=await open(f);await user.click(screen.getByRole("button",{name:"기기 등록"}));
    await user.click(modal().getByRole("button",{name:"등록"}));expect(writeCalls(f)).toHaveLength(0);
    expect(modal().getByText(/1~50자를 입력/)).toBeInTheDocument();expect(modal().getByText(/실제 설치 매장을 선택/)).toBeInTheDocument();
    await user.type(modal().getByLabelText("기기 코드"),"bad.code");await user.selectOptions(modal().getByLabelText("설치 매장"),"2");
    await user.click(modal().getByRole("button",{name:"등록"}));expect(writeCalls(f)).toHaveLength(0);
  });
  it("registers at a store with no devices and refreshes detail, list and shared dashboard only",async()=>{
    const f=fixture(),user=await open(f);const storeGets=f.requests.filter(r=>r.path==="/admin/stores").length;
    await createForm(user);await user.click(modal().getByRole("button",{name:"등록"}));
    await modal().findByRole("button",{name:"활성화"});expect(modal().getByText("New-002")).toBeInTheDocument();
    expect(modal().getByText("미확인")).toBeInTheDocument();
    expect(writeCalls(f)[0].body).toEqual({device_code:"New-002",store_id:2});
    await user.click(modal().getByRole("button",{name:"닫기"}));expect(screen.getByRole("table")).toHaveTextContent("New-002");
    await user.click(nav("운영 요약"));
    const summary=screen.getByRole("heading",{name:"기기 현황"}).closest("section")!;
    expect(summary).toHaveTextContent("등록 기기2대");expect(summary).toHaveTextContent("활성 기기1대");expect(summary).toHaveTextContent("비활성 기기1대");
    expect(f.order.load).toHaveBeenCalledTimes(1);expect(f.owner.load).toHaveBeenCalledTimes(1);expect(f.alert.load).toHaveBeenCalledTimes(1);
    expect(f.requests.filter(r=>r.path==="/admin/stores")).toHaveLength(storeGets);
  });
  it.each([409,422,503])("preserves registration form and safely displays failure %i",async(status)=>{
    const f=fixture();f.fail(status);const user=await open(f);await createForm(user);
    await user.click(modal().getByRole("button",{name:"등록"}));await modal().findByRole("alert");
    expect(modal().getByLabelText("기기 코드")).toHaveValue("New-002");expect(screen.queryByText("private-error-canary")).not.toBeInTheDocument();
    expect(f.devices).toHaveLength(1);
  });
  it("blocks duplicate registration, Escape, backdrop and cancellation while pending",async()=>{
    const f=fixture(),user=await open(f);const held=deferred();f.hold(held.promise);await createForm(user);
    const form=modal().getByLabelText("기기 코드").closest("form")!;fireEvent.submit(form);fireEvent.submit(form);
    await waitFor(()=>expect(writeCalls(f)).toHaveLength(1));expect(modal().getByRole("button",{name:"취소"})).toBeDisabled();
    await user.keyboard("{Escape}");expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog").parentElement!);expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async()=>held.resolve(f.json({},503)));await modal().findByRole("alert");
  });
  it("handles real-store failure, retry and zero stores without Mock fallback",async()=>{
    const f=fixture();f.failStores(true);const user=await open(f);await user.click(screen.getByRole("button",{name:"기기 등록"}));
    await modal().findByText("실제 매장 조회에 실패했습니다.");expect(modal().queryByRole("combobox")).not.toBeInTheDocument();
    f.failStores(false);f.stores.splice(0);await user.click(modal().getByRole("button",{name:"다시 시도"}));
    await modal().findByText(/등록된 매장이 없습니다/);await user.click(modal().getByRole("button",{name:"등록"}));expect(writeCalls(f)).toHaveLength(0);
  });
  it("requires confirmation and changes both directions with current detailed status",async()=>{
    const f=fixture(),user=await open(f);await statusForm(user);
    expect(modal().getByText(/이미 처리된 주문은 취소되지/)).toBeInTheDocument();
    await user.click(modal().getByRole("button",{name:"변경 저장"}));expect(writeCalls(f)).toHaveLength(0);
    await user.click(modal().getByRole("checkbox"));expect(modal().queryByRole("alert")).not.toBeInTheDocument();
    await user.click(modal().getByRole("button",{name:"변경 저장"}));await modal().findByRole("button",{name:"활성화"});
    expect(writeCalls(f)[0].body).toEqual({is_active:false,expected_is_active:true});
    await user.click(modal().getByRole("button",{name:"활성화"}));expect(modal().getByText(/신규 주문이 허용될 수/)).toBeInTheDocument();
    await user.click(modal().getByRole("checkbox"));await user.click(modal().getByRole("button",{name:"변경 저장"}));
    await modal().findByRole("button",{name:"비활성화"});expect(f.devices[0].is_active).toBe(true);
    expect(writeCalls(f)[1].body).toEqual({is_active:true,expected_is_active:false});
  });
  it("uses fresh detail rather than stale list for expected status and recovers conflict on cancellation",async()=>{
    const f=fixture(),user=await open(f);f.devices[0].is_active=false;
    await user.click(screen.getByRole("button",{name:"기기 상세: Existing-7"}));await user.click(await modal().findByRole("button",{name:"활성화"}));
    f.devices[0].is_active=true;await user.click(modal().getByRole("checkbox"));await user.click(modal().getByRole("button",{name:"변경 저장"}));
    await modal().findByText(/취소 후 실제 상세를 다시 조회/);await user.click(modal().getByRole("button",{name:"변경 저장"}));expect(writeCalls(f)).toHaveLength(1);
    await user.click(modal().getByRole("button",{name:"취소"}));const button=await modal().findByRole("button",{name:"비활성화"});expect(button).toHaveFocus();
  });
  it("guards duplicate status writes and closing while pending, then shows safe failure",async()=>{
    const f=fixture(),user=await open(f);await statusForm(user);const held=deferred();f.hold(held.promise);
    await user.click(modal().getByRole("checkbox"));const form=modal().getByRole("checkbox").closest("form")!;
    fireEvent.submit(form);fireEvent.submit(form);await waitFor(()=>expect(writeCalls(f)).toHaveLength(1));
    expect(modal().getByRole("button",{name:"취소"})).toBeDisabled();await user.keyboard("{Escape}");expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async()=>held.resolve(f.json({detail:"private-error-canary"},503)));await modal().findByRole("alert");expect(f.devices[0].is_active).toBe(true);
    expect(screen.queryByText("private-error-canary")).not.toBeInTheDocument();
  });
  it.each([[true,false],[false,true]])("does not offer real registration in mixed Mock settings %j",async(mockStores,mockDevices)=>{
    const f=fixture();await open(f,mockStores,mockDevices);expect(screen.queryByRole("button",{name:"기기 등록"})).not.toBeInTheDocument();expect(writeCalls(f)).toHaveLength(0);
  });
  it("sends allowlisted fields, CSRF credentials, and rejects invalid or mismatched responses",async()=>{
    const f=fixture();await f.repo.create({...{device_code:"New-002",store_id:2},is_active:true} as never);
    expect(writeCalls(f)[0].body).toEqual({device_code:"New-002",store_id:2});
    await f.repo.setStatus(7,{...{is_active:false,expected_is_active:true},store_id:2} as never);
    expect(writeCalls(f)[1].body).toEqual({is_active:false,expected_is_active:true});
    for(const [,init] of f.http.mock.calls) {expect(init?.credentials).toBe("include");expect(init?.cache).toBe("no-store");}
    const writeInit=f.http.mock.calls.find(([,init])=>init?.method==="POST")![1]!;
    expect(writeInit.headers).toHaveProperty("X-CSRF-Token");
    const count=f.requests.length;await expect(f.repo.create({device_code:"bad code",store_id:2})).rejects.toThrow();
    await expect(f.repo.setStatus(0,{is_active:true,expected_is_active:false})).rejects.toThrow();expect(f.requests).toHaveLength(count);
    const bad=new ApiDeviceRepository("http://localhost:8001",vi.fn<typeof fetch>().mockResolvedValueOnce(f.json({csrf_token:"c".repeat(43)})).mockResolvedValueOnce(f.json(raw(99))));
    await expect(bad.setStatus(7,{is_active:false,expected_is_active:true})).rejects.toThrow();
  });
});
