import { liveSnapshot } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

const POLL_MS = 10_000;

export const GET: RequestHandler = async ({ request, url }) => {
	if (url.searchParams.has('once')) {
		return Response.json(await liveSnapshot());
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;
			let timer: ReturnType<typeof setInterval> | undefined;

			const send = async () => {
				if (closed) return;
				try {
					const vehicles = await liveSnapshot();
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(vehicles)}\n\n`));
				} catch (error) {
					const message = error instanceof Error ? error.message : 'live query failed';
					controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(message)}\n\n`));
				}
			};

			const close = () => {
				if (closed) return;
				closed = true;
				clearInterval(timer);
				controller.close();
			};

			request.signal.addEventListener('abort', close);

			controller.enqueue(encoder.encode('retry: 5000\n\n'));
			await send();
			timer = setInterval(send, POLL_MS);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
