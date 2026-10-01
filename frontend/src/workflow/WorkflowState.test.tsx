// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AssignmentFooter, WorkflowProvider, type WorkflowState } from "./WorkflowState";
import { CompositionBoard } from "./CompositionBoard";
import { VersionInspector } from "./VersionInspector";
import { SplitPage } from "../App";
import { chooseVersion, emptyRecipe, recipeIssue } from "./composition";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture(): WorkflowState {
  const version = (id: string, name: string, parent_id?: string) => ({ id, name, count: 12, settings: { confidence: .2 }, reason: "", created_at: "2026-09-24T10:00", parent_id });
  return { project_id: "p", assignments: { pseudo: "p1" }, composition_id: null, compositions: [], catalog: { pseudo: [version("p1", "First"), version("p2", "Second")], augmentation: [version("a1", "Augmented", "p2")], open_data: [], split: [], training: [], conversion: [] } };
}
it("selecting an augment module brings its parent and saves the exact recipe", async () => {
  const state = fixture();
  vi.spyOn(api, "workflowState").mockResolvedValue(state);
  const save = mockSave(state);
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard /></WorkflowProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Use version · Augmented" }));
  fireEvent.click(screen.getByText("Save current combination"));
  fireEvent.change(screen.getByLabelText("Combination name"), { target: { value: "My mix" } });
  fireEvent.click(screen.getByRole("button", { name: "Save combination" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("p", { name: "My mix", pseudo_label_run_id: "p2", augmentation_run_id: "a1", open_data_import_id: null }));
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
it("drag and drop uses only the matching stage slot", async () => {
  vi.spyOn(api, "workflowState").mockResolvedValue(fixture());
  const save = mockSave(fixture());
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard /></WorkflowProvider>);
  await screen.findByRole("button", { name: "Use version · Augmented" });
  fireEvent.drop(screen.getByLabelText("Augment slot"), { dataTransfer: { getData: () => JSON.stringify({ stage: "augmentation", id: "a1" }) } });
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
function renderSplit(state: WorkflowState) {
  vi.spyOn(api, "workflowState").mockResolvedValue(state);
  vi.spyOn(api, "pseudoLabelRuns").mockResolvedValue([]);
  vi.spyOn(api, "augmentationRuns").mockResolvedValue([]);
  vi.spyOn(api, "openDataImports").mockResolvedValue([]);
  vi.spyOn(api, "datasetSplits").mockResolvedValue([]);
  const split = vi.spyOn(api, "split").mockResolvedValue({id:"job",name:"dataset_split",status:"queued",progress:0,message:"queued"});
  render(<WorkflowProvider projectId="p" revision="1"><SplitPage project={{id:"p",name:"Demo",description:"",root_path:"/tmp/demo"}} jobs={[]} refreshJobs={async()=>{}} t={key=>key} artifactRevision={0}/></WorkflowProvider>);
  return split;
}
it("builds directly from the cards, saving the exact draft without a separate assign step", async()=>{
  const state=fixture(), save=mockSave(state), assign=vi.spyOn(api,"assignWorkflow"), split=renderSplit(state);
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
  fireEvent.click(await screen.findByRole("button",{name:"Use combination"}));
  expect(assign).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Build New Split Version"}));
  await waitFor(()=>expect(split).toHaveBeenCalledWith("p",expect.objectContaining({composition_id:"saved",pseudo_label_run_id:"p2",augmentation_run_id:"a1"})));
  expect(save).not.toHaveBeenCalled();
});
it("preserves null project inputs for an Open Data-only build",async()=>{
  const state=fixture();
  state.catalog.open_data=[{id:"o1",name:"External",count:24,settings:{},reason:"",created_at:"2026-10-01"}];
  mockSave(state);const split=renderSplit(state);
  fireEvent.click(await screen.findByRole("button",{name:"Remove Pseudo"}));
  fireEvent.click(screen.getByRole("button",{name:"Use version · External"}));
  fireEvent.click(screen.getByRole("button",{name:"Build New Split Version"}));
  await waitFor(()=>expect(split).toHaveBeenCalledWith("p",expect.objectContaining({pseudo_label_run_id:null,augmentation_run_id:null,open_data_import_id:"o1"})));
});
it("does not submit a Split when saving the source combination fails",async()=>{
  vi.spyOn(api,"saveComposition").mockRejectedValue(new Error("Incompatible classes"));
  const split=renderSplit(fixture());
  await screen.findByRole("button",{name:"Remove Pseudo"});
  fireEvent.click(screen.getByRole("button",{name:"Build New Split Version"}));
  await screen.findByText("Could not save these inputs. Check the source versions and retry.");
  expect(split).not.toHaveBeenCalled();
});
it("navigates to the exact source and retains the draft when returning to Split",async()=>{
  vi.spyOn(api,"workflowState").mockResolvedValue(fixture());
  const assign=vi.spyOn(api,"assignWorkflow");
  function Harness(){const [page,setPage]=useState("split");return <WorkflowProvider projectId="p" revision="1" onNavigate={setPage}><output aria-label="Current page">{page}</output>{page==="split"?<CompositionBoard/>:<VersionInspector page={page}/>}</WorkflowProvider>;}
  render(<Harness/>);
  fireEvent.click(await screen.findByRole("button",{name:"Use version · Augmented"}));
  fireEvent.click(within(screen.getByLabelText("Augment slot")).getByRole("button",{name:"Open Augment version Augmented"}));
  expect(screen.getByLabelText("Current page").textContent).toBe("augment");
  expect(within(screen.getByLabelText("Selected source version")).getByRole("heading",{name:"Augmented"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Back to Split"}));
  expect(screen.getByRole("button",{name:"Use version · Second"}).getAttribute("aria-pressed")).toBe("true");
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
it("ignores a drop into the wrong source slot",async()=>{
  vi.spyOn(api,"workflowState").mockResolvedValue(fixture());
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard/></WorkflowProvider>);
  await screen.findByRole("button",{name:"Use version · Augmented"});
  fireEvent.drop(screen.getByLabelText("Pseudo slot"),{dataTransfer:{getData:()=>JSON.stringify({stage:"augmentation",id:"a1"})}});
  expect(screen.getByRole("button",{name:"Use version · First"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button",{name:"Use version · Augmented"}).getAttribute("aria-pressed")).toBe("false");
});
it("allows removing a source that disappeared while the draft was open",async()=>{
  const state=fixture();state.assignments.pseudo="gone";
  vi.spyOn(api,"workflowState").mockResolvedValue(state);
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard/></WorkflowProvider>);
  await screen.findByText("Version unavailable");
  fireEvent.click(screen.getByRole("button",{name:"Remove Pseudo"}));
  expect(screen.queryByText("Version unavailable")).toBeNull();
  expect(screen.queryByRole("button",{name:"Remove Pseudo"})).toBeNull();
});
