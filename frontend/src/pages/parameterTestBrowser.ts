// jsdom has no viewport geometry. Exercise real Tooltip interactions without
// collision flips; real-browser acceptance covers collisions and placement.
import {vi} from 'vitest';
vi.mock('@radix-ui/react-tooltip',async importOriginal=>{
  const actual=await importOriginal<typeof import('@radix-ui/react-tooltip')>();
  const React=await import('react');
  return {...actual,Content:React.forwardRef<HTMLDivElement,React.ComponentProps<typeof actual.Content>>((props,ref)=>React.createElement(actual.Content,{...props,ref,avoidCollisions:false}))};
});
