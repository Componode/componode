import { reissueLeaf } from './private-material.js';

await reissueLeaf('mock-alibaba');
console.log('[reissue] mock-alibaba cert regenerated with updated SANs');
