/**
 * Integration tests for MiniMax embedding provider.
 * These tests require a valid MINIMAX_API_KEY environment variable.
 * Run with: MINIMAX_API_KEY=your-key npx jest minimax-embedding.integration
 *
 * Note: MiniMax has strict RPM limits on the embedding API.
 * Tests include delays to avoid rate limiting.
 */
import { MiniMaxEmbedding } from '../minimax-embedding';

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

const describeIfApiKey = MINIMAX_API_KEY ? describe : describe.skip;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describeIfApiKey('MiniMaxEmbedding Integration Tests', () => {
    let embedding: MiniMaxEmbedding;

    beforeAll(() => {
        embedding = new MiniMaxEmbedding({
            apiKey: MINIMAX_API_KEY!,
        });
    });

    afterEach(async () => {
        // Delay between tests to avoid RPM rate limiting (MiniMax has strict RPM limits)
        await delay(12000);
    }, 15000);

    it('should detect dimension correctly', async () => {
        const dim = await embedding.detectDimension();
        expect(dim).toBe(1536);
    }, 30000);

    it('should embed a single text and return 1536-dimension vector', async () => {
        const result = await embedding.embed('Hello, world!');
        expect(result.vector).toHaveLength(1536);
        expect(result.dimension).toBe(1536);
        expect(result.vector.every(v => typeof v === 'number')).toBe(true);
    }, 30000);

    it('should embed batch of texts', async () => {
        const texts = ['TypeScript class', 'Python function', 'Go struct'];
        const results = await embedding.embedBatch(texts);
        expect(results).toHaveLength(3);
        results.forEach(r => {
            expect(r.vector).toHaveLength(1536);
            expect(r.dimension).toBe(1536);
        });
    }, 30000);
});
