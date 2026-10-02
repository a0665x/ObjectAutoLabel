// @vitest-environment jsdom
/// <reference types="vite/client" />
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {App, AugmentationControlPanel, ConversionTargetMatrix, HistoryDeleteButton, SettingsPage, WorkflowTimeline} from './App';
import {api} from './api/client';
import {UiLanguageProvider, uiText} from './uiText';
import {translate} from './i18n';
import {uiMessages} from './uiMessages';
import {workflowMessages} from './workflow/text';
import {ReviewEditMenu} from './components/review/ReviewEditMenu';
import {createReviewCommands} from './components/review/reviewCommands';
import type {Language} from './types';
import ts from 'typescript';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('updates page content as well as navigation when switching languages', async () => {
  vi.spyOn(api, 'authStatus').mockResolvedValue({enabled:false, authenticated:true, providers:[]});
  vi.spyOn(api, 'health').mockResolvedValue({project_root:'/data'} as Awaited<ReturnType<typeof api.health>>);
  vi.spyOn(api, 'projects').mockResolvedValue([]);
  vi.spyOn(api, 'jobs').mockResolvedValue([]);
  vi.spyOn(api, 'models').mockResolvedValue({world_models:[], world_model_details:[], input_models:[], output_models:[]});
  render(<App/>);
  const language = await screen.findByRole('combobox', {name:'Language'});
  fireEvent.change(language, {target:{value:'zh'}});
  expect(screen.getByRole('heading', {name:'切換專案'})).toBeTruthy();
  expect(screen.queryByText('Assign / switch project')).toBeNull();
  const input=screen.getByPlaceholderText('新專案名稱');
  fireEvent.change(input,{target:{value:'Original project name'}});
  for(const [locale,heading] of [['ja','プロジェクトの切り替え'],['ko','프로젝트 전환'],['en','Assign / switch project']]) {
    fireEvent.change(language,{target:{value:locale}});
    expect(screen.getByRole('heading',{name:heading})).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('Original project name');
  }
  fireEvent.click(within(document.querySelector('.nav')!).getByRole('button',{name:'Settings'}));
  for(const locale of ['zh','ja','ko','en'] as Language[]) {
    fireEvent.change(language,{target:{value:locale}});
    expect(screen.getByRole('heading',{name:uiText(locale)('Workflow defaults')})).toBeTruthy();
    expect(screen.getByText(uiText(locale)('Pretrained YOLO weights used by Train.'))).toBeTruthy();
    expect(document.documentElement.lang).toBe(locale==='zh'?'zh-Hant':locale);
  }
});

it.each(['zh','ja','ko'] as Language[])('localizes shared controls, portal menus and confirmations in %s without changing data',locale=>{
  const ui=uiText(locale);
  const toggle=vi.fn();
  const models={world_models:[],world_model_details:[],input_models:['model-original.pt'],output_models:[]};
  const commands=createReviewCommands({tool:'select',hasImage:true,hasSelection:true,hasClipboard:true,canUndo:true,canRedo:true,saving:false,handlers:{setTool:vi.fn(),copy:vi.fn(),paste:vi.fn(),duplicate:vi.fn(),delete:vi.fn(),relabel:vi.fn(),undo:vi.fn(),redo:vi.fn(),cancel:vi.fn(),save:vi.fn(),saveAndNext:vi.fn()}});
  const content=<>
    <SettingsPage models={models} t={key=>translate(locale,key)} />
    <AugmentationControlPanel settings={{effects:[],copies:3,skip:false}} onChange={vi.fn()} onEditEffect={vi.fn()}/>
    <ConversionTargetMatrix selected={['tflite:fp32']} onToggle={toggle}/>
    <ReviewEditMenu commands={commands}/>
    <HistoryDeleteButton projectId="p1" artifactType="pseudo" artifactId="v1" label="Original Version" onDeleted={async()=>{}}/>
    <WorkflowTimeline jobs={[{id:'j',project_id:'p1',name:'pseudo_label',status:'completed',progress:100,message:'Original diagnostic'}]}/>
  </>;
  const view=render(<UiLanguageProvider language={locale}>{content}</UiLanguageProvider>);
  expect(screen.getByRole('heading',{name:ui('Workflow defaults')})).toBeTruthy();
  expect(screen.getByRole('button',{name:'+ '+ui('Blur Filter')})).toBeTruthy();
  expect(screen.getByRole('option',{name:'model-original.pt'})).toBeTruthy();
  const skip=screen.getByRole('option',{name:ui('Skip augment')}) as HTMLOptionElement;
  expect(skip.value).toBe('Skip augment');
  expect(document.querySelector('.timeline-item')?.className).toBe('timeline-item status-completed');
  expect(screen.getByText(/Original diagnostic/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:ui('Edit')}));
  expect(within(screen.getByRole('menu')).getByText(ui('Copy'))).toBeTruthy();
  expect(document.querySelector('[role="menu"]')?.parentElement).toBe(document.body);
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button',{name:ui('Delete {v0} history {v1}',{v0:ui('pseudo'),v1:'Original Version'})}));
  expect(confirm).toHaveBeenCalledWith(ui('Delete {type} history “{name}” and {downstream}? Project input and the shared Open Data cache will be preserved.',{type:ui('pseudo'),name:'Original Version',downstream:ui('downstream Augment, Split, Training, Conversion and Export history')}));
  view.rerender(<UiLanguageProvider language="en">{content}</UiLanguageProvider>);
  expect(skip.textContent).toBe('Skip augment');
  expect(within(screen.getByRole('menu')).getByText('Copy')).toBeTruthy();
});

it('keeps every declared UI message translated in all three non-English languages',()=>{
  const technical=new Set(['(id:','B','Ctrl+D','Ctrl+wheel','D','H','Jetson ARM64','N/A','ONNX opset','Shift+drag','Space+drag','Ultralytics Platform','classes.json','id','iou=','metadata.json','x']);
  const files=import.meta.glob<string>(['./App.tsx','./pages/{OpenDataPage,ReviewPage,CliWorkspace}.tsx','./components/review/*.tsx','./workflow/WorkflowState.tsx','!./**/*.test.tsx'],{query:'?raw',import:'default',eager:true});
  const missing:string[]=[];
  for(const [path,source] of Object.entries(files)) {
    const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function visit(node:ts.Node) {
      if(ts.isCallExpression(node)&&node.expression.getText(ast)==='ui'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])) {
        const key=node.arguments[0].text;
        if(!technical.has(key)&&!uiMessages[key]&&!workflowMessages[key])missing.push(`${path}: ${key}`);
      }
      ts.forEachChild(node,visit);
    }
    visit(ast);
  }
  expect(missing).toEqual([]);
  for(const [key,translations] of Object.entries(uiMessages)) {
    expect(translations).toHaveLength(3);
    for(const value of translations){
      expect(value.trim()).not.toBe('');
      for(const match of value.matchAll(/\{(\w+)\}/g))expect(key).toContain(match[0]);
    }
  }
});
