// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {PseudoPage,SourcesPage} from './App';
import {api,ApiError} from './api/client';
import {WorkflowProvider,type WorkflowState} from './workflow/WorkflowState';
import {UiLanguageProvider,uiText} from './uiText';
import {areaToPosition} from './components/BoxAreaRange';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const project={id:'p',name:'Project',description:'',root_path:'/tmp/project'};
const models={world_models:['yolov8s-world.pt'],world_model_details:[],input_models:[],output_models:[]};
function mockSources(sourceId?:string){
  let state:WorkflowState={project_id:'p',assignments:sourceId?{source:sourceId}:{},composition_id:null,compositions:[],catalog:{source:[
    {id:'old',name:'Old images',count:930,settings:{path:'/raw/old',kind:'image_folder'},reason:'',created_at:'2026-10-12'},
    {id:'new',name:'中庄imgs_1012',count:130,settings:{path:'/raw/中庄imgs_1012',kind:'image_folder'},reason:'',created_at:'2026-10-13'},
    {id:'video',name:'clip.mp4',count:0,settings:{path:'/raw/clip.mp4',kind:'video'},reason:'Source has no registered images; register images or extract video frames first',created_at:'2026-10-13'},
  ],pseudo:[],augmentation:[],open_data:[],split:[],training:[],conversion:[]}};
  vi.spyOn(api,'workflowState').mockImplementation(async()=>state);
  const assign=vi.spyOn(api,'assignWorkflow').mockImplementation(async(_project,stage,id)=>{
    state={...state,assignments:id?{[stage]:id}:{}};return state;
  });
  vi.spyOn(api,'sources').mockResolvedValue([{id:'old',project_id:'p',kind:'image_folder',path:'/raw/old'},{id:'new',project_id:'p',kind:'image_folder',path:'/raw/中庄imgs_1012'},{id:'video',project_id:'p',kind:'video',path:'/raw/clip.mp4'}]);
  vi.spyOn(api,'classSchemas').mockResolvedValue([{id:'schema',project_id:'p',name:'people',classes:[{class_id:0,class_name:'person',descriptors:['person']}]}]);
  vi.spyOn(api,'pseudoLabelRuns').mockResolvedValue([]);
  vi.spyOn(api,'pseudoAreaDistribution').mockResolvedValue({bins:[],box_count:0,suggested_max:1/3,pre_filter:true});
  const generate=vi.spyOn(api,'pseudoLabel').mockResolvedValue({id:'j',project_id:'p',name:'pseudo_label',status:'queued',progress:0,message:'queued'});
  return {assign,generate};
}
function Pseudo(){return <PseudoPage project={project} models={models} jobs={[]} refreshJobs={async()=>{}} t={key=>key}/>;}

it('assigns a Source history version and passes only its id from Pseudo',async()=>{
  const {assign,generate}=mockSources('old');
  function Harness(){const [page,setPage]=useState('sources');return <WorkflowProvider projectId="p" revision="1"><button onClick={()=>setPage('pseudo')}>Open Pseudo</button>{page==='sources'?<SourcesPage project={project} refresh={async()=>{}} refreshArtifacts={async()=>{}} t={key=>key}/>:<Pseudo/>}</WorkflowProvider>;}
  render(<Harness/>);
  const row=(await screen.findByText(/中庄imgs_1012 · image_folder/)).closest('article')!;
  fireEvent.click(within(row).getByRole('button',{name:'Assign Source'}));
  await screen.findByText('Assigned: 中庄imgs_1012');
  expect(assign).toHaveBeenCalledWith('p','source','new');
  fireEvent.click(screen.getByRole('button',{name:'Open Pseudo'}));
  await waitFor(()=>expect((screen.getByLabelText('Source version') as HTMLSelectElement).value).toBe('new'));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Generate Pseudo Labels'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Generate Pseudo Labels'}));
  await waitFor(()=>expect(generate).toHaveBeenCalledWith('p',expect.objectContaining({source_asset_id:'new',schema_id:'schema'})));
});

it('requires explicit source choice and preserves edited settings while switching its assignment',async()=>{
  const {assign,generate}=mockSources();
  const view=render(<UiLanguageProvider language="en"><WorkflowProvider projectId="p" revision="1"><Pseudo/></WorkflowProvider></UiLanguageProvider>);
  await screen.findByRole('option',{name:/中庄imgs_1012/});
  expect((screen.getByRole('button',{name:'Generate Pseudo Labels'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('option',{name:/clip.mp4/}) as HTMLOptionElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Pseudo build name'),{target:{value:'My run'}});
  fireEvent.change(screen.getByLabelText('Source version'),{target:{value:'new'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Generate Pseudo Labels'}) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText('Pseudo build name') as HTMLInputElement).value).toBe('My run');
  view.rerender(<UiLanguageProvider language="zh"><WorkflowProvider projectId="p" revision="1" language="zh"><Pseudo/></WorkflowProvider></UiLanguageProvider>);
  expect((screen.getByLabelText(uiText('zh')('Source version')) as HTMLSelectElement).value).toBe('new');
  expect((screen.getByLabelText(uiText('zh')('Pseudo build name')) as HTMLInputElement).value).toBe('My run');
  expect(assign).toHaveBeenCalledOnce();expect(generate).not.toHaveBeenCalled();
});

it('preserves an entered run name when source and history requests finish later',async()=>{
  mockSources('new');
  let finish!:(runs:Awaited<ReturnType<typeof api.pseudoLabelRuns>>)=>void;
  vi.mocked(api.pseudoLabelRuns).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  render(<WorkflowProvider projectId="p" revision="1"><Pseudo/></WorkflowProvider>);
  await screen.findByRole('option',{name:/中庄imgs_1012/});
  fireEvent.change(screen.getByLabelText('Pseudo build name'),{target:{value:'My source run'}});
  finish([]);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Generate Pseudo Labels'}) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText('Pseudo build name') as HTMLInputElement).value).toBe('My source run');
});

it.each([false,true])('requires explicit duplicate confirmation (confirm=%s)',async(confirmed)=>{
  mockSources();
  const create=vi.spyOn(api,'createSource').mockRejectedValueOnce(new ApiError('Already registered',409,{code:'duplicate_source'})).mockResolvedValue({id:'duplicate',project_id:'p',kind:'image_folder',path:'/raw/中庄imgs_1012'});
  vi.spyOn(api,'sourceAnalysis').mockResolvedValue({image_count:130,known_dimensions:0,extensions:{},top_sizes:[]});
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(confirmed);
  render(<WorkflowProvider projectId="p" revision="1"><SourcesPage project={project} refresh={async()=>{}} refreshArtifacts={async()=>{}} t={key=>key}/></WorkflowProvider>);
  fireEvent.change(screen.getByLabelText('Selected folder'),{target:{value:'/raw/中庄imgs_1012'}});
  fireEvent.click(screen.getByRole('button',{name:'Process & analysis'}));
  await waitFor(()=>expect(confirm).toHaveBeenCalled());
  if(confirmed)await waitFor(()=>expect(create).toHaveBeenLastCalledWith('p',{kind:'image_folder',path:'/raw/中庄imgs_1012',allow_duplicate:true}));
  else {expect(create).toHaveBeenCalledOnce();expect(api.sourceAnalysis).not.toHaveBeenCalled();}
});

it('confirms Source history deletion and refreshes removed rows',async()=>{
  mockSources('new');
  const remove=vi.spyOn(api,'deleteHistory').mockResolvedValue({deleted:{source:1},removed_paths:[]});
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  render(<WorkflowProvider projectId="p" revision="1"><SourcesPage project={project} refresh={async()=>{}} refreshArtifacts={async()=>{}} t={key=>key}/></WorkflowProvider>);
  const button=await screen.findByRole('button',{name:'Delete Source history 中庄imgs_1012'});
  fireEvent.click(button);expect(remove).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  vi.mocked(api.sources).mockResolvedValue([{id:'old',project_id:'p',kind:'image_folder',path:'/raw/old'}]);
  fireEvent.click(button);
  await waitFor(()=>expect(remove).toHaveBeenCalledWith('p','source','new'));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Delete Source history 中庄imgs_1012'})).toBeNull());
});

it('has one Pseudo history surface and submits optional configurable area filtering',async()=>{
  const {generate}=mockSources('new');
  render(<WorkflowProvider projectId="p" revision="1"><Pseudo/></WorkflowProvider>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Generate Pseudo Labels'}) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText('Previous pseudo-label runs')).toBeNull();
  const toggle=screen.getByRole('checkbox',{name:'Automatically filter large boxes'});
  expect((toggle as HTMLInputElement).checked).toBe(false);
  fireEvent.click(toggle);
  expect(screen.getByRole('slider',{name:'Maximum box area'}).getAttribute('aria-valuetext')).toMatch(/33\.333%/);
  fireEvent.change(screen.getByRole('slider',{name:'Maximum box area'}),{target:{value:String(areaToPosition(.25))}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Generate Pseudo Labels'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Generate Pseudo Labels'}));
  await waitFor(()=>expect(generate).toHaveBeenCalledWith('p',expect.objectContaining({filter_large_boxes:true,max_box_area_ratio:expect.closeTo(.25,5),min_box_area_ratio:0,area_filter_mode:'manual'})));
});
