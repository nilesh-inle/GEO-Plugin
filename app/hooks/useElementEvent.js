import { useEffect, useRef } from "react";

/**
 * Listens for a DOM event on an element. React 18 doesn't attach `onChange`
 * and similar props to custom elements such as Polaris web components.
 */
export function useElementEvent(ref, eventName, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const listener = (event) => handlerRef.current(event);
    element.addEventListener(eventName, listener);
    return () => element.removeEventListener(eventName, listener);
  }, [ref, eventName]);
}
