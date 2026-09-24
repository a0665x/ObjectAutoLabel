// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { AssignmentFooter, WorkflowProvider, type WorkflowState } from "./WorkflowState";
import { CompositionBoard } from "./CompositionBoard";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture(): WorkflowState {
  const version = (id: string, name: string, parent_id?: string) => ({ id, name, count: 12, settings: { confidence: .2 }, reason: "", created_at: "2026-09-24T10:00", parent_id });
  return { project_id: "p", assignments: { pseudo: "p1" }, composition_id: null, compositions: [], catalog: { pseudo: [version("p1", "First"), version("p2", "Second")], augmentation: [version("a1", "Augmented", "p2")], open_data: [], split: [], training: [], conversion: [] } };
}
it("selecting an augment module brings its parent and saves the exact recipe", async () => {
  const state = fixture();
  vi.spyOn(api, "workflowState").mockResolvedValue(state);
  const save = vi.spyOn(api, "saveComposition").mockResolvedValue(state);
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard /></WorkflowProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Use version · Augmented" }));
  fireEvent.change(screen.getByLabelText("Composition name"), { target: { value: "My mix" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & assign composition" }));
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
  const save = vi.spyOn(api, "saveComposition").mockResolvedValue(fixture());
  render(<WorkflowProvider projectId="p" revision="1"><CompositionBoard /></WorkflowProvider>);
  await screen.findByRole("button", { name: "Use version · Augmented" });
  fireEvent.drop(screen.getByLabelText("Augment slot"), { dataTransfer: { getData: () => JSON.stringify({ stage: "augmentation", id: "a1" }) } });
  fireEvent.change(screen.getByLabelText("Composition name"), { target: { value: "Dropped" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & assign composition" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("p", expect.objectContaining({ pseudo_label_run_id: "p2", augmentation_run_id: "a1" })));
});
