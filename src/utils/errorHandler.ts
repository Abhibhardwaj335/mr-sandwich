import { error } from './response';

export function handleError(context: string, err: unknown) {
  if (err instanceof Error) {
    console.error(`🔥 Error ${context}:`, err);
    return error({ message: `Error ${context}`, details: err.message }, 500);
  } else {
    console.error(`🔥 Unknown error ${context}:`, err);
    return error({ message: `Unknown error during ${context}`}, 500);
  }
}
