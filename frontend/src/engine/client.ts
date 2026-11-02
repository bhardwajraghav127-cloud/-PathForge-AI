// Shared EngineClient singleton + status hook (M6).
import { useEffect, useState } from 'react';
import { EngineClient, type EngineStatus } from './EngineClient';

export const engineClient = new EngineClient();

export function useEngineStatus(): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>(engineClient.status);
  useEffect(() => {
    engineClient.onStatus = setStatus;
    return () => {
      if (engineClient.onStatus === setStatus) engineClient.onStatus = null;
    };
  }, []);
  return status;
}
