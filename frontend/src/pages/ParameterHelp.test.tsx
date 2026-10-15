// @vitest-environment jsdom
import './parameterTestBrowser';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {ParameterHelp} from './ParameterHelp';
import {StreamSwitch} from './StreamControls';
import {opticalFlowHelp,type FlowHelpKey} from './opticalFlowText';
import {trackingHelp,trackingVisualizationHelp} from './trackingText';
afterEach(cleanup);
const help='Sample count. Higher: denser. Lower: lighter.';

it('opens on keyboard focus, describes the trigger and closes on Escape',async()=>{
  const user=userEvent.setup();
  render(<ParameterHelp label="Columns" help={help} technicalKey="cols"/>);
  expect(screen.queryByRole('tooltip')).toBeNull();
  await user.tab();
  const tooltip=await screen.findByRole('tooltip');expect(tooltip.textContent).toContain(help);
  expect(tooltip.textContent).toContain('cols');
  expect(screen.getByRole('button',{name:'Help: Columns'}).getAttribute('aria-describedby')).toBe(tooltip.id);
  await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('tooltip')).toBeNull());
});

it('supports mouse hover without toggling the associated setting',async()=>{
  const user=userEvent.setup(),onChange=vi.fn();
  render(<StreamSwitch label="Points" checked={false} onChange={onChange} help={help}/>);
  const trigger=screen.getByRole('button',{name:'Help: Points'});
  await user.hover(trigger);expect((await screen.findByRole('tooltip')).textContent).toContain('Higher:');
  expect(onChange).not.toHaveBeenCalled();
});

it('lets users inspect a disabled setting and localizes the accessible help name',async()=>{
  render(<StreamSwitch label="取樣點" checked={false} disabled onChange={vi.fn()} help="開啟：顯示取樣點。關閉：隱藏。" language="zh"/>);
  fireEvent.click(screen.getByRole('button',{name:'參數說明: 取樣點'}));
  expect((await screen.findByRole('tooltip')).textContent).toContain('開啟');
});

it('provides localized meaning and both trade-offs for every numeric flow control',()=>{
  const terms={en:['Higher:','Lower:'],zh:['越大','越小'],ja:['大きい','小さい'],ko:['높을수록','낮을수록']};
  for(const language of ['en','zh','ja','ko'] as const){
    for(const key of ['cols','rows','gain','trail','quality','radius','threshold'] satisfies FlowHelpKey[]){
      const text=opticalFlowHelp(language,key);
      for(const term of terms[language])expect(text).toContain(term);
    }
    const text=trackingHelp(language,'TRACKING_ID_STABILIZER_CONFIRM_FRAMES')!;
    for(const term of terms[language])expect(text).toContain(term);
    expect(trackingVisualizationHelp(language,'prediction')).toContain('200');
  }
  expect(trackingHelp('en','UNSUPPORTED_KEY')).toBeUndefined();
});
