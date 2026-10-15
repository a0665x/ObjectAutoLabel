// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {OpticalFlowPanel} from './OpticalFlowPanel';
import {defaultFlowSettings,type FlowSummary} from './opticalFlowModel';
afterEach(cleanup);
it('exposes a separate default-off checkbox and preserves grid preferences when disabled',()=>{
  const onChange=vi.fn();const props={settings:defaultFlowSettings,onChange,onReset:vi.fn()};
  const view=render(<OpticalFlowPanel {...props}/>);
  expect((screen.getByLabelText('Show optical flow') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByLabelText('Grid columns').matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByLabelText('Show optical flow'));
  expect(onChange).toHaveBeenCalledWith({...defaultFlowSettings,enabled:true});
  view.rerender(<OpticalFlowPanel {...props} settings={{...defaultFlowSettings,enabled:true}}/>);
  fireEvent.change(screen.getByLabelText('Grid columns'),{target:{value:'16'}});
  fireEvent.blur(screen.getByLabelText('Grid columns'));
  expect(onChange).toHaveBeenLastCalledWith({...defaultFlowSettings,enabled:true,cols:16});
  fireEvent.change(screen.getByRole('slider',{name:'Arrow gain'}),{target:{value:'5'}});
  expect(onChange).toHaveBeenLastCalledWith({...defaultFlowSettings,enabled:true,gain:5});
  fireEvent.change(screen.getByRole('combobox',{name:'Arrow direction'}),{target:{value:'gradient'}});
  expect(onChange).toHaveBeenLastCalledWith({...defaultFlowSettings,enabled:true,vector:'gradient'});
  expect(screen.getByLabelText('Color by')).toBeTruthy();expect(screen.getByLabelText('Analysis maximum size')).toBeTruthy();
});
it('allows clearing Grid columns and typing a multi-digit value without resetting intermediate text',()=>{
  const onChange=vi.fn();
  render(<OpticalFlowPanel settings={{...defaultFlowSettings,enabled:true}} onChange={onChange} onReset={vi.fn()}/>);
  const input=screen.getByLabelText('Grid columns') as HTMLInputElement;
  fireEvent.change(input,{target:{value:''}});
  expect(input.value).toBe('');
  fireEvent.change(input,{target:{value:'1'}});
  expect(input.value).toBe('1');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(input,{target:{value:'16'}});
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalledExactlyOnceWith({...defaultFlowSettings,enabled:true,cols:16});
});
it('shows real measured units, avoids accuracy claims and localizes the new controls',()=>{
  const summary:FlowSummary={state:'measured',valid:72,total:144,motion:2,speed:30,angle:45,dt:1/15,time:2,ms:12,width:640,height:360};
  const props={settings:{...defaultFlowSettings,enabled:true},onChange:vi.fn(),onReset:vi.fn(),summary};
  const view=render(<OpticalFlowPanel {...props}/>);
  expect(screen.getByText('72 / 144')).toBeTruthy();expect(screen.getByText('30.0 px/s')).toBeTruthy();
  expect(view.container.textContent).toContain('not real-world speed');
  for(const language of ['zh','ja','ko','en'] as const)view.rerender(<OpticalFlowPanel {...props} language={language}/>);
  expect(view.container.textContent).not.toMatch(/[\u3400-\u9fff]/);
  view.rerender(<OpticalFlowPanel {...props} terminal/>);
  expect((screen.getByLabelText('Show optical flow') as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByText('72 / 144')).toBeNull();
});
