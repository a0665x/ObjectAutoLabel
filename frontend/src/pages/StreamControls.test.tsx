// @vitest-environment jsdom
import {useState} from 'react';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {StreamSegments, StreamSwitch} from './StreamControls';
afterEach(cleanup);

it('offers a mutually exclusive native choice with a labelled group',async()=>{
  const user=userEvent.setup();
  function Example(){const[value,setValue]=useState('video');return <StreamSegments label="Source" value={value} onChange={setValue} options={[{value:'video',label:'Video'},{value:'camera',label:'Camera'}]}/>;}
  render(<Example/>);
  expect(screen.getByRole('group',{name:'Source'})).toBeTruthy();
  await user.click(screen.getByRole('radio',{name:'Camera'}));
  expect((screen.getByRole('radio',{name:'Camera'}) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('radio',{name:'Video'}) as HTMLInputElement).checked).toBe(false);
});

it('supports keyboard switches and honors disabled state',async()=>{
  const user=userEvent.setup(),onChange=vi.fn();
  const view=render(<StreamSwitch label="Tracking" checked={false} onChange={onChange}/>);
  await user.tab(); await user.keyboard(' ');
  expect(onChange).toHaveBeenCalledWith(true);
  view.rerender(<StreamSwitch label="Tracking" checked={false} onChange={onChange} disabled/>);
  onChange.mockClear(); await user.click(screen.getByRole('switch',{name:'Tracking'}));
  expect(onChange).not.toHaveBeenCalled();
});
