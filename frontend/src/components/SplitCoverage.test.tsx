// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {api, type SplitCoverage as Coverage} from '../api/client';
import {SplitCoverage,coverageBatches} from './SplitCoverage';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const coverage:Coverage={split_id:'s',split_name:'Split_A',provenance:'frozen',seed:42,ordering:'source_then_filename',total:10,all_counts:{train:8,valid:1,test:1},counts:{train:8,valid:1,test:1},group_id:null,
  window:{start:0,end:1,first_index:1,last_index:10,count:10},window_counts:{train:8,valid:1,test:1},
  groups:[{id:'g',name:'Pseudo · A → Augment · A',kind:'augment',source_name:'camera_a',source_asset_id:'source',pseudo_label_run_id:'p',pseudo_name:'A',augmentation_run_id:'a',augmentation_name:'A',open_data_import_id:null,open_data_name:null,total:10,counts:{train:8,valid:1,test:1},bucket_share:{train:1,valid:1,test:1}}],
  bins:[{index:0,first_index:1,last_index:5,counts:{train:4,valid:1,test:0}},{index:1,first_index:6,last_index:10,counts:{train:4,valid:0,test:1}}]};

it('shows one batch per upstream Pseudo/Augment pair rather than duplicate cards for retained source folders',()=>{
  const data={...coverage,all_counts:{train:12,valid:2,test:1},groups:[coverage.groups[0],{...coverage.groups[0],id:'other-folder',source_name:'camera_b',total:5,counts:{train:4,valid:1,test:0}}]};
  const groups=coverageBatches(data);
  expect(groups).toHaveLength(1);expect(groups[0].total).toBe(15);expect(groups[0].counts).toEqual({train:12,valid:2,test:1});
  expect(groups[0].bucket_share).toEqual({train:1,valid:1,test:1});expect(groups[0].source_name).toBe('camera_a / camera_b');
  expect(coverage.groups[0].total).toBe(10);
});

it('shows saved source allocation and a draggable inspection range without eagerly loading image pixels',async()=>{
  const data=vi.spyOn(api,'datasetSplitCoverage').mockResolvedValue(coverage);
  const sample=vi.spyOn(api,'datasetSplitCoverageSample');
  const fetch=vi.spyOn(globalThis,'fetch');
  render(<SplitCoverage projectId="p" splitId="s" language="en"/>);
  await screen.findByText('Pseudo · A → Augment · A');
  expect(screen.getByRole('slider',{name:'Coverage start'})).toBeTruthy();
  expect(screen.getByRole('slider',{name:'Coverage end'})).toBeTruthy();
  expect(screen.getByRole('slider',{name:'Preview saved allocation'})).toBeTruthy();
  expect(sample).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(document.querySelector('.coverage-batches')?.hasAttribute('open')).toBe(false);
  expect(document.querySelectorAll('.coverage-row-labels span')).toHaveLength(3);
  fireEvent.change(screen.getByRole('slider',{name:'Coverage start'}),{target:{value:'20'}});
  await waitFor(()=>expect(data).toHaveBeenLastCalledWith('p','s',expect.objectContaining({start:.2}),expect.any(AbortSignal)));
});

it('loads only a bounded thumbnail on deliberate hover or keyboard preview, and releases it on unmount',async()=>{
  vi.spyOn(api,'datasetSplitCoverage').mockResolvedValue(coverage);
  const sample=vi.spyOn(api,'datasetSplitCoverageSample').mockResolvedValue({image_id:'i',file_name:'frame.jpg',bucket:'train',group_id:'g',group_name:'Pseudo A',index:2,total:8,thumbnail_url:'/thumbnail/i'});
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new Blob(['thumbnail'],{type:'image/jpeg'})));
  const create=vi.fn(()=> 'blob:thumbnail'); const revoke=vi.fn();
  class ThumbnailURL extends URL {static createObjectURL=create;static revokeObjectURL=revoke;}
  vi.stubGlobal('URL',ThumbnailURL);
  const view=render(<SplitCoverage projectId="p" splitId="s" language="en"/>);
  await screen.findByText('Pseudo · A → Augment · A');
  const preview=screen.getByRole('slider',{name:'Preview saved allocation'});
  fireEvent.focus(preview);fireEvent.change(preview,{target:{value:'20'}});
  await screen.findByRole('img',{name:'Saved Split preview frame.jpg'});
  expect(sample).toHaveBeenLastCalledWith('p','s','train',.25,undefined,expect.any(AbortSignal));
  expect(create).toHaveBeenCalledOnce();
  view.unmount();expect(revoke).toHaveBeenCalledWith('blob:thumbnail');
});

it('does not show stale distribution when a different Split is selected',async()=>{
  let complete:(value:Coverage)=>void=()=>{};
  vi.spyOn(api,'datasetSplitCoverage').mockImplementation((_pid,sid)=>sid==='old'?new Promise(resolve=>{complete=resolve;}):Promise.resolve({...coverage,split_id:'new',split_name:'New Split'}));
  const view=render(<SplitCoverage projectId="p" splitId="old" language="en"/>);
  await waitFor(()=>expect(api.datasetSplitCoverage).toHaveBeenCalled());
  view.rerender(<SplitCoverage projectId="p" splitId="new" language="en"/>);
  await screen.findByText('New Split');complete({...coverage,split_name:'Old Split'});
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(screen.queryByText('Old Split')).toBeNull();
});
