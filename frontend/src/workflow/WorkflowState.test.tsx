// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AssignmentFooter, WorkflowProvider, type WorkflowState } from "./WorkflowState";
import { CompositionBoard } from "./CompositionBoard";
import { VersionInspector } from "./VersionInspector";
import { SplitPage } from "../App";
import { chooseVersion, emptyRecipe, recipeIssue, sourceBranches } from "./composition";
import type {Language, DatasetSplitRun} from '../types';
import {workflowMessages, workflowText} from './text';
import {WorkflowError} from './WorkflowError';
import userEvent from '@testing-library/user-event';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function openPicker(stage: 'pseudo'|'augmentation'|'open_data') {
  const node=await waitFor(()=>{const button=document.querySelector<HTMLButtonElement>(`[data-flow-stage="${stage}"]`);expect(button).not.toBeNull();return button!;});
  if(node.getAttribute('aria-expanded')!=='true')fireEvent.click(node);
}
it('reveals one flow picker on click, keeps it open after pointer leave, and returns focus on Escape',async()=>{
  vi.spyOn(api,'workflowState').mockResolvedValue(fixture());
  const save=vi.spyOn(api,'saveComposition'),assign=vi.spyOn(api,'assignWorkflow');
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard/></WorkflowProvider>);
  const pseudo=await screen.findByRole('button',{name:'Choose Pseudo version'});
  expect(screen.queryByRole('button',{name:'Use version · First'})).toBeNull();
  fireEvent.mouseEnter(pseudo);
  expect(pseudo.getAttribute('aria-expanded')).toBe('false');
  const user=userEvent.setup();pseudo.focus();await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(document.querySelector('.composition-version-panel'));
  fireEvent.mouseLeave(pseudo);
  expect(screen.getByRole('button',{name:'Use version · First'})).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(pseudo);
  expect(pseudo.getAttribute('aria-expanded')).toBe('false');
  await user.keyboard(' ');
  fireEvent.click(pseudo);
  expect(pseudo.getAttribute('aria-expanded')).toBe('false');
  await openPicker('pseudo');await openPicker('augmentation');
  expect(document.querySelectorAll('.composition-version-panel')).toHaveLength(1);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('button',{name:'Use version · Augmented'})).toBeNull();
  expect(save).not.toHaveBeenCalled();expect(assign).not.toHaveBeenCalled();
});
it('updates the linked flow nodes and total without double-counting Pseudo, then collapses the picker',async()=>{
  const state=fixture();state.catalog.open_data=[{id:'o1',name:'External',count:24,settings:{},reason:'',created_at:''}];
  state.assignments.open_data='o1';
  vi.spyOn(api,'workflowState').mockResolvedValue(state);
  const configure=vi.fn();
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard onConfigureSplit={configure}/></WorkflowProvider>);
  await openPicker('augmentation');
  fireEvent.click(screen.getByRole('button',{name:'Use version · Augmented'}));
  expect(screen.getByRole('button',{name:'Choose Pseudo version'}).textContent).toContain('Second');
  expect(screen.getByRole('button',{name:'Choose Augment version'}).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByText('Approx. 36 images')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Choose Augment version'}));
  fireEvent.click(screen.getByRole('button',{name:'Set ratios & build'}));expect(configure).toHaveBeenCalledOnce();
});
it('keeps unavailable versions inspectable but unselectable and does not mutate locked drafts',async()=>{
  const state=fixture();state.catalog.augmentation[0].reason='Outdated';
  vi.spyOn(api,'workflowState').mockResolvedValue(state);
  const rendered=render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard/></WorkflowProvider>);
  await openPicker('augmentation');
  expect((screen.getByRole('button',{name:'Use version · Augmented'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:'Open Augment version Augmented'}) as HTMLButtonElement).disabled).toBe(false);
  rendered.rerender(<WorkflowProvider projectId="p" revision="1"><CompositionBoard disabled/></WorkflowProvider>);
  expect((screen.getByRole('button',{name:'Choose Pseudo version'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:'Open Augment version Augmented'}) as HTMLButtonElement).disabled).toBe(true);
});
function fixture(): WorkflowState {
  const version = (id: string, name: string, parent_id?: string) => ({ id, name, count: 12, settings: { confidence: .2 }, reason: "", created_at: "2026-09-24T10:00", parent_id });
  return { project_id: "p", assignments: { pseudo: "p1" }, composition_id: null, compositions: [], catalog: { pseudo: [version("p1", "First"), version("p2", "Second")], augmentation: [version("a1", "Augmented", "p2")], open_data: [], split: [], training: [], conversion: [] } };
}
it("selecting an augment module brings its parent and saves the exact recipe", async () => {
  const state = fixture();
  vi.spyOn(api, "workflowState").mockResolvedValue(state);
  const save = mockSave(state);
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard /></WorkflowProvider>);
  await openPicker('augmentation');
  fireEvent.click(await screen.findByRole("button", { name: "Use version · Augmented" }));
  fireEvent.click(screen.getByText('Saved combinations'));
  fireEvent.click(screen.getByText("Save current combination"));
  fireEvent.change(screen.getByLabelText("Combination name"), { target: { value: "My mix" } });
  fireEvent.click(screen.getByRole("button", { name: "Save combination" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("p", { name: "My mix", pseudo_label_run_id: "p2", augmentation_run_id: "a1", open_data_import_id: null }));
});

it('adds parallel source groups through the existing picker and builds their exact union',async()=>{
  const state=fixture();
  state.catalog.augmentation.push({id:'a2',name:'First augment',count:30,settings:{},reason:'',created_at:'',parent_id:'p1'});
  state.catalog.open_data=[{id:'o1',name:'External',count:24,settings:{},reason:'',created_at:''}];
  state.assignments.open_data='o1';
  const save=mockSave(state),split=renderSplit(state);
  await openPicker('augmentation');
  fireEvent.click(screen.getByRole('button',{name:'Use version · First augment'}));
  fireEvent.click(screen.getByRole('button',{name:'Add Pseudo → Augment group'}));
  expect(screen.getByRole('heading',{name:'Pseudo · Source group 2'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Use version · Second'}));
  fireEvent.click(screen.getByRole('button',{name:'Choose Augment version · Source group 2'}));
  fireEvent.click(screen.getByRole('button',{name:'Use version · Augmented'}));
  expect(screen.getByText('Approx. 66 images')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Build New Split Version'}));
  await waitFor(()=>expect(save).toHaveBeenCalledWith('p',expect.objectContaining({branches:[{pseudo_label_run_id:'p1',augmentation_run_id:'a2'},{pseudo_label_run_id:'p2',augmentation_run_id:'a1'}],open_data_import_id:'o1'})));
  await waitFor(()=>expect(split).toHaveBeenCalledWith('p',expect.objectContaining({composition_id:'c1'})));
});

it('keeps parent linkage local to its group, rejects duplicates and removes an empty group',async()=>{
  const state=fixture();
  const draft={...emptyRecipe,pseudo_label_run_id:'p1',branches:[{pseudo_label_run_id:'p1',augmentation_run_id:null},{pseudo_label_run_id:'p2',augmentation_run_id:null}]};
  const next=chooseVersion(state,draft,'augmentation','a1',1);
  expect(sourceBranches(next)[0]).toEqual(draft.branches[0]);
  expect(sourceBranches(next)[1]).toEqual({pseudo_label_run_id:'p2',augmentation_run_id:'a1'});
  expect(recipeIssue(state,{...draft,branches:[draft.branches[0],draft.branches[0]]})).toMatch('twice');
  vi.spyOn(api,'workflowState').mockResolvedValue(state);
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard/></WorkflowProvider>);
  await screen.findByRole('button',{name:'Add Pseudo → Augment group'});
  fireEvent.click(screen.getByRole('button',{name:'Add Pseudo → Augment group'}));
  fireEvent.keyDown(document.querySelector('.composition-flow-workspace')!,{key:'Escape'});
  fireEvent.click(screen.getByRole('button',{name:'Remove source group 2'}));
  expect(screen.getByRole('button',{name:'Choose Pseudo version'}).textContent).toContain('First');
});
it("footer assignment updates the shared state and deletion requires confirmation", async () => {
  const state = fixture();
  vi.spyOn(api, "workflowState").mockResolvedValue(state);
  vi.spyOn(api, "assignWorkflow").mockResolvedValue({ ...state, assignments: { pseudo: "p2" } });
  const remove = vi.spyOn(api, "deleteHistory").mockResolvedValue({ deleted: { pseudo: 1 }, removed_paths: [] });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<WorkflowProvider projectId="p" revision="1"><AssignmentFooter page="pseudo" onDeleted={async () => {}} /></WorkflowProvider>);
  fireEvent.click((await screen.findAllByRole("button", { name: "Assign Pseudo" }))[1]);
  expect(await screen.findByText("Assigned: Second")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Delete saved pseudo Second" }));
  expect(confirm).toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});
it("has one direct version selector per source and no duplicate compose slots", async () => {
  vi.spyOn(api, "workflowState").mockResolvedValue(fixture());
  const save = mockSave(fixture());
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard /></WorkflowProvider>);
  await openPicker('augmentation');
  await screen.findByRole("button", { name: "Use version · Augmented" });
  expect(document.querySelector('.composition-slots')).toBeNull();
  expect(screen.getAllByRole('button',{name:'Use version · Augmented'})).toHaveLength(1);
  expect(document.querySelector('.composition-history')?.hasAttribute('open')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Use version · Augmented'}));
  fireEvent.click(screen.getByText('Saved combinations'));
  fireEvent.click(screen.getByText("Save current combination"));
  fireEvent.change(screen.getByLabelText("Combination name"), { target: { value: "Dropped" } });
  fireEvent.click(screen.getByRole("button", { name: "Save combination" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("p", expect.objectContaining({ pseudo_label_run_id: "p2", augmentation_run_id: "a1" })));
});

function mockSave(state: WorkflowState) {
  return vi.spyOn(api, "saveComposition").mockImplementation(async (_id, recipe) => ({
    ...state, composition_id: "c1", compositions: [{...recipe, id: "c1", reason: "", created_at: "2026-10-01"}]
  }));
}
function renderSplit(state: WorkflowState, language:Language='en', savedSplits:Array<DatasetSplitRun & {composition_id?:string}> = []) {
  vi.spyOn(api, "workflowState").mockResolvedValue(state);
  vi.spyOn(api, "pseudoLabelRuns").mockResolvedValue([]);
  vi.spyOn(api, "augmentationRuns").mockResolvedValue([]);
  vi.spyOn(api, "openDataImports").mockResolvedValue([]);
  vi.spyOn(api, "datasetSplits").mockResolvedValue(savedSplits);
  vi.spyOn(api, "datasetSplitSamples").mockResolvedValue({train:[],valid:[],test:[]});
  const split = vi.spyOn(api, "split").mockResolvedValue({id:"job",name:"dataset_split",status:"queued",progress:0,message:"queued"});
  render(<WorkflowProvider projectId="p" revision="1" language={language}><SplitPage project={{id:"p",name:"Demo",description:"",root_path:"/tmp/demo"}} jobs={[]} refreshJobs={async()=>{}} t={key=>key} artifactRevision={0}/></WorkflowProvider>);
  return split;
}
it("builds directly from the cards, saving the exact draft without a separate assign step", async()=>{
  const state=fixture(), save=mockSave(state), assign=vi.spyOn(api,"assignWorkflow"), split=renderSplit(state);
  await openPicker('augmentation');
  fireEvent.click(await screen.findByRole("button",{name:"Use version · Augmented"}));
  fireEvent.click(screen.getByRole("button",{name:"Build New Split Version"}));
  await waitFor(()=>expect(split).toHaveBeenCalledWith("p",expect.objectContaining({composition_id:"c1",pseudo_label_run_id:"p2",augmentation_run_id:"a1",open_data_import_id:null,train_ratio:.8,val_ratio:.1,test_ratio:.1})));
  expect(save).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
});
it("uses a saved combination locally and reuses its id when building",async()=>{
  const state=fixture();
  state.compositions=[{id:"saved",name:"Reusable",pseudo_label_run_id:"p2",augmentation_run_id:"a1",open_data_import_id:null,reason:"",created_at:"2026-10-01"}];
  const save=mockSave(state), assign=vi.spyOn(api,"assignComposition"), split=renderSplit(state);
  await screen.findByText('Reusable');
  fireEvent.click(screen.getByText('Saved combinations'));
  fireEvent.click(screen.getByRole("button",{name:"Use combination"}));
  expect(assign).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Build New Split Version"}));
  await waitFor(()=>expect(split).toHaveBeenCalledWith("p",expect.objectContaining({composition_id:"saved",pseudo_label_run_id:"p2",augmentation_run_id:"a1"})));
  expect(save).not.toHaveBeenCalled();
});
it("preserves null project inputs for an Open Data-only build",async()=>{
  const state=fixture();
  state.catalog.open_data=[{id:"o1",name:"External",count:24,settings:{},reason:"",created_at:"2026-10-01"}];
  mockSave(state);const split=renderSplit(state);
  await openPicker('pseudo');
  fireEvent.click(await screen.findByRole("button",{name:"Remove Pseudo"}));
  await openPicker('open_data');
  fireEvent.click(screen.getByRole("button",{name:"Use version · External"}));
  fireEvent.click(screen.getByRole("button",{name:"Build New Split Version"}));
  await waitFor(()=>expect(split).toHaveBeenCalledWith("p",expect.objectContaining({pseudo_label_run_id:null,augmentation_run_id:null,open_data_import_id:"o1"})));
});
it("does not submit a Split when saving the source combination fails",async()=>{
  vi.spyOn(api,"saveComposition").mockRejectedValue(new Error("Incompatible classes"));
  const split=renderSplit(fixture());
  await screen.findByRole("button",{name:"Choose Pseudo version"});
  fireEvent.click(screen.getByRole("button",{name:"Build New Split Version"}));
  await screen.findByText("Could not save these inputs. Check the source versions and retry.");
  expect(split).not.toHaveBeenCalled();
});
it("navigates to the exact source and retains the draft when returning to Split",async()=>{
  vi.spyOn(api,"workflowState").mockResolvedValue(fixture());
  const assign=vi.spyOn(api,"assignWorkflow");
  function Harness(){const [page,setPage]=useState("split");return <WorkflowProvider projectId="p" revision="1" onNavigate={setPage}><output aria-label="Current page">{page}</output>{page==="split"?<CompositionBoard/>:<VersionInspector page={page}/>}</WorkflowProvider>;}
  render(<Harness/>);
  await openPicker('augmentation');
  fireEvent.click(await screen.findByRole("button",{name:"Use version · Augmented"}));
  await openPicker('augmentation');
  fireEvent.click(screen.getByRole("button",{name:"Open Augment version Augmented"}));
  expect(screen.getByLabelText("Current page").textContent).toBe("augment");
  expect(within(screen.getByLabelText("Selected source version")).getByRole("heading",{name:"Augmented"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Back to Split"}));
  await openPicker('pseudo');
  expect(screen.getByRole("button",{name:"Use version · Second"}).getAttribute("aria-pressed")).toBe("true");
  await openPicker('augmentation');
  expect(screen.getByRole("button",{name:"Use version · Augmented"}).getAttribute("aria-pressed")).toBe("true");
  expect(assign).not.toHaveBeenCalled();
});
it("clears incompatible augmentation and rejects missing, unavailable or mismatched inputs",()=>{
  const state=fixture();
  const augmented=chooseVersion(state,emptyRecipe,"augmentation","a1");
  expect(chooseVersion(state,augmented,"pseudo","p1")).toEqual({...emptyRecipe,pseudo_label_run_id:"p1"});
  expect(chooseVersion(state,augmented,"pseudo","missing")).toBe(augmented);
  expect(recipeIssue(state,{...augmented,pseudo_label_run_id:"p1"})).toMatch(/recorded Pseudo/);
  expect(recipeIssue(state,{...augmented,pseudo_label_run_id:"gone"})).toMatch(/no longer available/);
  state.catalog.augmentation[0].reason="Outdated";
  expect(recipeIssue(state,augmented)).toBe("Outdated");
  expect(chooseVersion(state,emptyRecipe,"augmentation","a1")).toBe(emptyRecipe);
});
it("clearing the Pseudo column also clears its dependent Augment selection",async()=>{
  vi.spyOn(api,"workflowState").mockResolvedValue(fixture());
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard/></WorkflowProvider>);
  await openPicker('augmentation');
  await screen.findByRole("button",{name:"Use version · Augmented"});
  fireEvent.click(screen.getByRole('button',{name:'Use version · Augmented'}));
  await openPicker('pseudo');
  fireEvent.click(screen.getByRole('button',{name:'Remove Pseudo'}));
  await openPicker('pseudo');
  expect(screen.getByRole("button",{name:"Use version · Second"}).getAttribute("aria-pressed")).toBe("false");
  await openPicker('augmentation');
  expect(screen.getByRole("button",{name:"Use version · Augmented"}).getAttribute("aria-pressed")).toBe("false");
});
it.each([
  ['zh','資料來源','建立切分版本','比例說明'],
  ['ja','データソース','分割バージョンを作成','比率の説明'],
  ['ko','데이터 소스','분할 버전 생성','비율 설명'],
] as const)('localizes Split content, instructions, sample labels and validation in %s',async(language,heading,build,help)=>{
  const split=renderSplit(fixture(),language), w=workflowText(language);
  await screen.findByRole('heading',{name:heading});
  expect(screen.getByRole('button',{name:build})).toBeTruthy();
  fireEvent.click(screen.getByText(help));
  expect(screen.getByText(w('Validation portion: images used during training to monitor overfitting and select best.pt.'))).toBeTruthy();
  expect(screen.getByRole('heading',{name:w('Training samples')})).toBeTruthy();
  fireEvent.change(screen.getByLabelText(w('Train ratio')),{target:{value:'1.2'}});
  expect(screen.getByText(w('Invalid split: Train + Validation cannot exceed 1.00.'))).toBeTruthy();
  expect((screen.getByRole('button',{name:build}) as HTMLButtonElement).disabled).toBe(true);
  expect(split).not.toHaveBeenCalled();
  expect(screen.queryByText('Set ratios & build')).toBeNull();
});
it('updates existing feedback and the version inspector when language changes without losing selection',async()=>{
  vi.spyOn(api,'workflowState').mockResolvedValue(fixture());
  function Harness(){
    const [language,setLanguage]=useState<Language>('en'),[page,setPage]=useState('split');
    return <WorkflowProvider projectId="p" revision="1" language={language} onNavigate={setPage}><button onClick={()=>setLanguage('zh')}>中文</button><button onClick={()=>setLanguage('ja')}>日本語</button>{page==='split'?<CompositionBoard/>:<VersionInspector page={page}/>}</WorkflowProvider>;
  }
  render(<Harness/>);
  await openPicker('augmentation');
  fireEvent.click(await screen.findByRole('button',{name:'Use version · Augmented'}));
  fireEvent.click(screen.getByRole('button',{name:'中文'}));
  expect(screen.getByRole('status').textContent).toBe('已選擇擴增版本，並自動連動其原標註版本。');
  await openPicker('pseudo');
  expect(screen.getByRole('button',{name:'使用版本 · Second'}).getAttribute('aria-pressed')).toBe('true');
  await openPicker('augmentation');
  fireEvent.click(screen.getByRole('button',{name:'查看資料擴增版本 Augmented'}));
  expect(screen.getByRole('heading',{name:'Augmented'})).toBeTruthy();
  expect(screen.getByText('信心閾值')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'日本語'}));
  expect(screen.getByText('信頼度の閾値')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'分割に戻る'}));
  await openPicker('augmentation');
  expect(screen.getByRole('button',{name:'バージョンを使用 · Augmented'}).getAttribute('aria-pressed')).toBe('true');
});
it('keeps all localized message placeholders compatible',()=>{
  for(const [key,translations] of Object.entries(workflowMessages)){
    const placeholders=(value:string)=>[...value.matchAll(/\{\w+\}/g)].map(match=>match[0]).sort();
    expect(translations).toHaveLength(3);
    for(const translated of translations){expect(translated.trim()).not.toBe('');expect(placeholders(translated)).toEqual(placeholders(key));}
  }
});
it('localizes saved Split history and its deletion confirmation without changing names',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const remove=vi.spyOn(api,'deleteHistory');
  renderSplit(fixture(),'zh',[{id:'s1',name:'Split_original_name',is_current:true,composition_id:'c1',pseudo_label_run_id:null,augmentation_run_id:null,open_data_import_id:'o1',image_ids_json:'{"train":["i1"]}',train_ratio:.8,val_ratio:.1,test_ratio:.1,dataset_yaml_path:'/data/original_path/data.yaml'}]);
  await screen.findByRole('option',{name:'Split_original_name · 1 張圖片'});
  expect(screen.getByRole('button',{name:'使用此切分進行訓練'})).toBeTruthy();
  fireEvent.click(screen.getByText('所有切分版本與來源'));
  fireEvent.click(screen.getByRole('button',{name:'刪除切分紀錄 Split_original_name'}));
  expect(confirm).toHaveBeenCalledWith('刪除切分「Split_original_name」及依賴它的訓練／匯出紀錄？原始來源將保留。');
  expect(remove).not.toHaveBeenCalled();
  expect(screen.queryByText('All project labels')).toBeNull();
});
it.each(['Infinity','NaN','-0.2','1.2'])('does not submit an invalid ratio %s',async value=>{
  const split=renderSplit(fixture(),'zh');
  await screen.findByRole('heading',{name:'資料來源'});
  fireEvent.change(screen.getByLabelText('訓練比例'),{target:{value}});
  expect((screen.getByRole('button',{name:'建立切分版本'}) as HTMLButtonElement).disabled).toBe(true);
  expect(split).not.toHaveBeenCalled();
});
it('localizes known source errors and retains unknown diagnostics in details',()=>{
  vi.spyOn(api,'workflowState').mockResolvedValue(fixture());
  render(<WorkflowProvider projectId="p" revision="1" language="zh"><WorkflowError message="augmentation version is not complete"/><WorkflowError message="Server diagnostic 123"/></WorkflowProvider>);
  expect(screen.getByText('此版本尚未完成，請等待工作結束。')).toBeTruthy();
  expect(screen.getByText('操作未完成，請查看詳細資訊後重試。')).toBeTruthy();
  expect(screen.getByText('Server diagnostic 123').closest('details')?.open).toBe(false);
});
it("allows removing a source that disappeared while the draft was open",async()=>{
  const state=fixture();state.assignments.pseudo="gone";
  vi.spyOn(api,"workflowState").mockResolvedValue(state);
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard/></WorkflowProvider>);
  await screen.findAllByText("Version unavailable");
  await openPicker('pseudo');
  fireEvent.click(screen.getByRole("button",{name:"Remove Pseudo"}));
  expect(screen.queryByText("Version unavailable")).toBeNull();
  expect(screen.queryByRole("button",{name:"Remove Pseudo"})).toBeNull();
});
