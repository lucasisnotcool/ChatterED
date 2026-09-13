import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('chattered', { ping: () => 'pong' });
