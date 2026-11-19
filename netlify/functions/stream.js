import { decryptDesEcb } from '../../orange/js/providers/des.js';

export default async (req) => {
    try {
        const incomingUrl = new URL(req.url);
        const query = incomingUrl.searchParams.get('q');

        if (!query) {
            return Response.json(
                { error: 'Missing query parameter q' },
                { status: 400 }
            );
        }

        const apiUrl = new URL('https://www.jiosaavn.com/api.php');

        apiUrl.searchParams.set('__call', 'search.getResults');
        apiUrl.searchParams.set('_format', 'json');
        apiUrl.searchParams.set('_marker', '0');
        apiUrl.searchParams.set('api_version', '4');
        apiUrl.searchParams.set('ctx', 'web6dot0');
        apiUrl.searchParams.set('q', query);

        const response = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
        });

        if (!response.ok) {
            return Response.json(
                { error: `JioSaavn returned ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        const item = data.results?.[0];

        if (!item) {
            return Response.json(
                { error: 'No stream found' },
                { status: 404 }
            );
        }

        const encrypted = item.more_info?.encrypted_media_url;

        if (!encrypted) {
            return Response.json(
                { error: 'No media URL found' },
                { status: 404 }
            );
        }

        const decryptedUrl = decryptDesEcb(encrypted);
        const highQualityUrl = decryptedUrl.replace(/_[0-9]+\.mp4$/, '_320.mp4');

        return Response.json({
            success: true,
            url: highQualityUrl,
            fallbackUrl: decryptedUrl,
            title: item.title,
            artist: item.more_info?.singers ||
                item.more_info?.artistMap?.primary_artists?.[0]?.name || '',
            duration: Number(item.more_info?.duration) || 0,
        });

    } catch (error) {
        return Response.json(
            { error: error.message || 'Stream resolution failed' },
            { status: 500 }
        );
    }
};