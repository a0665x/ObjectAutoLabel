// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {ParameterNumberInput} from './ParameterNumberInput';
afterEach(cleanup);

it('commits a complete typed integer once on Enter, not after each digit',async()=>{
  const user=userEvent.setup(),onCommit=vi.fn();
  function Example(){const [value,setValue]=useState(12);return <ParameterNumberInput ariaLabel="Columns" value={value} min={2} max={40} integer onCommit={n=>{onCommit(n);setValue(n);}}/>;}
  render(<Example/>);
  const input=screen.getByRole('spinbutton',{name:'Columns'}) as HTMLInputElement;
  await user.clear(input);await user.type(input,'1');expect(input.value).toBe('1');
  await user.type(input,'6');expect(onCommit).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');expect(input.value).toBe('16');expect(onCommit).toHaveBeenCalledExactlyOnceWith(16);
});

it.each(['','1','41','12.5'])('does not commit an invalid integer draft %j on blur',draft=>{
  const onCommit=vi.fn(),onValidityChange=vi.fn();
  render(<ParameterNumberInput ariaLabel="Columns" value={12} min={2} max={40} integer onCommit={onCommit} onValidityChange={onValidityChange}/>);
  const input=screen.getByRole('spinbutton') as HTMLInputElement;
  fireEvent.change(input,{target:{value:draft}});fireEvent.blur(input);
  expect(input.value).toBe(draft);expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(onCommit).not.toHaveBeenCalled();expect(onValidityChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByText('Whole number · 2–40')).toBeTruthy();
});

it('restores the last committed value on Escape and accepts the range endpoints',async()=>{
  const user=userEvent.setup(),onCommit=vi.fn();
  render(<ParameterNumberInput ariaLabel="Columns" value={12} min={2} max={40} integer onCommit={onCommit}/>);
  const input=screen.getByRole('spinbutton') as HTMLInputElement;
  await user.clear(input);await user.type(input,'55');await user.keyboard('{Escape}');
  expect(input.value).toBe('12');expect(input.getAttribute('aria-invalid')).toBeNull();
  expect(onCommit).not.toHaveBeenCalled();
  for(const n of [2,40]){fireEvent.change(input,{target:{value:String(n)}});fireEvent.blur(input);expect(onCommit).toHaveBeenLastCalledWith(n);}
});

it('preserves decimal editing and reacts to external default resets',async()=>{
  const user=userEvent.setup(),onCommit=vi.fn();
  const props={ariaLabel:'Tolerance',value:.7,min:0,max:1,onCommit};
  const view=render(<ParameterNumberInput {...props}/>);
  const input=screen.getByRole('spinbutton') as HTMLInputElement;
  await user.clear(input);await user.type(input,'0.85');await user.tab();
  expect(input.value).toBe('0.85');expect(onCommit).toHaveBeenCalledExactlyOnceWith(.85);
  view.rerender(<ParameterNumberInput {...props} value={.9}/>);expect(input.value).toBe('0.9');
});
