// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TrackingSettingsPanel } from './TrackingSettingsPanel';
import * as api from '../api/streamDemo';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const defaults={AI_TRACK_MINIMUM_MATCHING_THRESHOLD:.7,TRACK_MOTION_KALMAN_ENABLE:true,TRACKING_ID_STABILIZER_CONFIRM_FRAMES:3};
const properties={AI_TRACK_MINIMUM_MATCHING_THRESHOLD:{type:'number',minimum:0,maximum:1},TRACK_MOTION_KALMAN_ENABLE:{type:'boolean'},TRACKING_ID_STABILIZER_CONFIRM_FRAMES:{type:'integer',minimum:1,maximum:30}};
const viz={trails:true,prediction:true,topology:false,diagnostics:true};

it('uses the exact backend/YAML keys and disables algorithm changes while streaming',async()=>{
  vi.spyOn(api,'streamRequest').mockResolvedValue({defaults,properties});
  const onChange=vi.fn(),onViz=vi.fn();
  const props={settings:{},onChange,busy:false,viz,onViz,fps:15};
  const view=render(<TrackingSettingsPanel {...props}/>);
  fireEvent.click(screen.getByText('Tracking · motion / topology'));
  const input=await screen.findByLabelText('TRACKING_ID_STABILIZER_CONFIRM_FRAMES');
  fireEvent.change(input,{target:{value:'7'}});
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
  expect(view.container.textContent).toContain('Higher:');
  expect(view.container.textContent).toContain('Lower:');
  view.rerender(<TrackingSettingsPanel {...props} language="zh"/>);
  expect(screen.getByText('追蹤 · 運動／拓撲')).toBeTruthy();
  expect(view.container.textContent).toContain('越大');
  view.rerender(<TrackingSettingsPanel {...props} language="ja"/>);
  expect(screen.getByText('追跡 · 動き／トポロジー')).toBeTruthy();
  expect(view.container.textContent).toContain('大きい');
  view.rerender(<TrackingSettingsPanel {...props} language="ko"/>);
  expect(screen.getByText('추적 · 움직임 / 토폴로지')).toBeTruthy();
  expect(view.container.textContent).toContain('높을수록');
});
