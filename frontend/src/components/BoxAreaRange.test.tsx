// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {areaToPosition,positionToArea,BoxAreaRange} from './BoxAreaRange';

afterEach(cleanup);
it('round trips logarithmic area positions and renders truthful empty statistics',()=>{
  for(const area of [0,.0001,.01,1/3,1])expect(positionToArea(areaToPosition(area))).toBeCloseTo(area,9);
  render(<BoxAreaRange distribution={null} range={[0,1/3]} automatic loading={false} error="" onChange={()=>{}} onSuggest={()=>{}}/>);
  expect(screen.getAllByRole('slider')).toHaveLength(2);
  expect(screen.getByText(/No box statistics yet/)).toBeTruthy();
});
it('shows counted bins, moves both bounds, prevents crossing and restores Auto',()=>{
  const change=vi.fn(),suggest=vi.fn();
  render(<BoxAreaRange distribution={{bins:[{lower:0,upper:.02,count:100},{lower:.5,upper:1,count:50}],box_count:150,suggested_max:.25,pre_filter:true}} range={[0,.25]} automatic={false} loading={false} error="" onChange={change} onSuggest={suggest}/>);
  expect(screen.getByText('≈ 100 kept · 50 excluded')).toBeTruthy();
  fireEvent.change(screen.getByRole('slider',{name:'Minimum box area'}),{target:{value:String(areaToPosition(.01))}});
  expect(change.mock.calls[0][0][0]).toBeCloseTo(.01);
  fireEvent.change(screen.getByRole('slider',{name:'Maximum box area'}),{target:{value:'100'}});
  expect(change).toHaveBeenLastCalledWith([0,1]);
  fireEvent.change(screen.getByRole('slider',{name:'Minimum box area'}),{target:{value:'100'}});
  expect(change.mock.calls.at(-1)![0][0]).toBeLessThan(.25);
  fireEvent.click(screen.getByRole('button',{name:'Suggested range'}));expect(suggest).toHaveBeenCalledOnce();
});
