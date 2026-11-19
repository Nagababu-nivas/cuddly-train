export default async (req) => {
    try {
        const incomingUrl = new URL(req.url);
        const query = incomingUrl.searchParams.get('q');

        if (!query) {
            return new Response(
                JSON.stringify({ error: 'Missing query parameter q' }),
                {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        const apiUrl = new URL('https://www.jiosaavn.com/api.php');

        for (const [key, value] of incomingUrl.searchParams.entries()) {
            apiUrl.searchParams.set(key, value);
        }

        if (!apiUrl.searchParams.has('__call')) {
            apiUrl.searchParams.set('__call', 'search.getResults');
        }

        const response = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
        });

        if (!response.ok) {
            return new Response(
                JSON.stringify({ error: `JioSaavn returned ${response.status}` }),
                {
                    status: response.status,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        const data = await response.json();

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message || 'Saavn request failed' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }
};