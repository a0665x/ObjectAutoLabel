// @vitest-environment jsdom
import './parameterTestBrowser';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { TrackingSettingsPanel } from './TrackingSettingsPanel';
import * as api from '../api/streamDemo';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const defaults={AI_TRACK_MINIMUM_MATCHING_THRESHOLD:.7,TRACK_MOTION_KALMAN_ENABLE:true,TRACKING_ID_STABILIZER_CONFIRM_FRAMES:3};
const properties={AI_TRACK_MINIMUM_MATCHING_THRESHOLD:{type:'number',minimum:0,maximum:1},TRACK_MOTION_KALMAN_ENABLE:{type:'boolean'},TRACKING_ID_STABILIZER_CONFIRM_FRAMES:{type:'integer',minimum:1,maximum:30}};
const viz={enabled:true,trails:true,prediction:true,topology:false,diagnostics:true};
it('preserves detail preferences behind a live master switch and explains missing IDs',async()=>{
  vi.spyOn(api,'streamRequest').mockResolvedValue({defaults,properties});
  const onViz=vi.fn();
  const props={settings:{TRACK_MOTION_MAX_PREDICTION_MS:400,TRACKING_BRIDGE_TTL_MS:400},onChange:vi.fn(),busy:true,viz:{...viz,enabled:false},onViz,fps:1};
  const view=render(<TrackingSettingsPanel {...props}/>);
  await screen.findByLabelText('TRACKING_ID_STABILIZER_CONFIRM_FRAMES');
  expect(screen.getByLabelText('Topology · neighbor links').matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByLabelText('Show tracking overlays'));
  expect(onViz).toHaveBeenCalledWith({...viz,enabled:true});
  view.rerender(<TrackingSettingsPanel {...props} viz={viz} status={{detections:4,tracks:0,motion:0,forecasts:0,links:0}}/>);
  expect(screen.getByRole('status').textContent).toContain('No confirmed IDs');
  expect(screen.getByText(/Frame interval exceeds Kalman/)).toBeTruthy();
});

it('uses the exact backend/YAML keys and disables algorithm changes while streaming',async()=>{
  vi.spyOn(api,'streamRequest').mockResolvedValue({defaults,properties});
  const onChange=vi.fn(),onViz=vi.fn();
  const props={settings:{},onChange,busy:false,viz,onViz,fps:15};
  const view=render(<TrackingSettingsPanel {...props}/>);
  fireEvent.click(screen.getByText('Tracking · motion / topology'));
  const input=await screen.findByLabelText('TRACKING_ID_STABILIZER_CONFIRM_FRAMES');
  fireEvent.change(input,{target:{value:'7'}});
  fireEvent.blur(input);
  expect(onChange).toHaveBeenLastCalledWith({...defaults,TRACKING_ID_STABILIZER_CONFIRM_FRAMES:7});
  fireEvent.click(screen.getByRole('radio',{name:'ByteTrack'}));
  expect(screen.getByLabelText('AI_TRACK_MINIMUM_MATCHING_THRESHOLD')).toBeTruthy();
  view.rerender(<TrackingSettingsPanel {...props} busy/>);
  expect(screen.getByRole('radio',{name:'ByteTrack'}).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByLabelText('Topology · neighbor links'));
  expect(onViz).toHaveBeenCalledWith({...viz,topology:true});
});

it('uses the selected language without project-specific wording or YAML import',async()=>{
  vi.spyOn(api,'streamRequest').mockResolvedValue({defaults,properties});
  const props={settings:{},onChange:vi.fn(),busy:false,viz,onViz:vi.fn(),fps:30};
  const view=render(<TrackingSettingsPanel {...props}/>);
  fireEvent.click(screen.getByText('Tracking · motion / topology'));
  await screen.findByLabelText('TRACKING_ID_STABILIZER_CONFIRM_FRAMES');
  expect(view.container.textContent).not.toMatch(/[\u3400-\u9fff]|autopilot|env_config|Osiris/);
  expect(view.container.querySelector('input[type=file]')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Help: Confirmation frames'}));
  expect((await screen.findByRole('tooltip')).textContent).toContain('Higher:');
  expect(screen.getByRole('tooltip').textContent).toContain('Lower:');
  view.rerender(<TrackingSettingsPanel {...props} language="zh"/>);
  expect(screen.getByText('追蹤 · 運動／拓撲')).toBeTruthy();
  expect(screen.getByRole('tooltip').textContent).toContain('越大');
  view.rerender(<TrackingSettingsPanel {...props} language="ja"/>);
  expect(screen.getByText('追跡 · 動き／トポロジー')).toBeTruthy();
  expect(screen.getByRole('tooltip').textContent).toContain('大きい');
  view.rerender(<TrackingSettingsPanel {...props} language="ko"/>);
  expect(screen.getByText('추적 · 움직임 / 토폴로지')).toBeTruthy();
  expect(screen.getByRole('tooltip').textContent).toContain('높을수록');
});

it('keeps invalid drafts across parameter groups, blocks resume and resets them with defaults',async()=>{
  vi.spyOn(api,'streamRequest').mockResolvedValue({defaults,properties});
  const onChange=vi.fn(),onValidityChange=vi.fn(),user=userEvent.setup();
  render(<TrackingSettingsPanel settings={{}} onChange={onChange} onValidityChange={onValidityChange} busy={false} viz={viz} onViz={vi.fn()} fps={15}/>);
  fireEvent.click(screen.getByText('Tracking · motion / topology'));
  const input=await screen.findByLabelText('TRACKING_ID_STABILIZER_CONFIRM_FRAMES') as HTMLInputElement;
  await user.clear(input);await user.type(input,'31');await user.tab();
  expect(input.value).toBe('31');expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(onChange).not.toHaveBeenCalled();expect(onValidityChange).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole('radio',{name:'ByteTrack'}));
  expect(onValidityChange).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole('radio',{name:'Identity / topology'}));
  expect(input.value).toBe('31');
  await user.click(screen.getByRole('button',{name:'Reset defaults'}));
  expect((screen.getByLabelText('TRACKING_ID_STABILIZER_CONFIRM_FRAMES') as HTMLInputElement).value).toBe('3');
  expect(onValidityChange).toHaveBeenLastCalledWith(true);
});

it('keeps parameter help usable while algorithm controls are locked during playback',async()=>{
  vi.spyOn(api,'streamRequest').mockResolvedValue({defaults,properties});
  render(<TrackingSettingsPanel settings={{}} onChange={vi.fn()} busy viz={viz} onViz={vi.fn()} fps={15}/>);
  fireEvent.click(screen.getByText('Tracking · motion / topology'));
  await screen.findByLabelText('TRACKING_ID_STABILIZER_CONFIRM_FRAMES');
  fireEvent.click(screen.getByRole('button',{name:'Help: Confirmation frames'}));
  expect((await screen.findByRole('tooltip')).textContent).toContain('Consecutive accepted observations');
});
