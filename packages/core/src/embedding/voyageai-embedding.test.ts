import { VoyageAIClient } from 'voyageai';
import { VoyageAIEmbedding } from './voyageai-embedding';

const mockEmbed = jest.fn();

jest.mock('voyageai', () => ({
    VoyageAIClient: jest.fn().mockImplementation(() => ({
        embed: mockEmbed,
    })),
}));

describe('VoyageAIEmbedding', () => {
    beforeEach(() => {
        mockEmbed.mockReset();
        (VoyageAIClient as unknown as jest.Mock).mockClear();
    });

    it('keeps voyage-4-nano metadata aligned with its default dimension', async () => {
        const supportedModels = VoyageAIEmbedding.getSupportedModels();

        expect(supportedModels['voyage-4-nano']).toMatchObject({
            dimension: '1024 (default), 256, 512, 2048',
            contextLength: 32000,
        });

        const embedding = new VoyageAIEmbedding({
            apiKey: 'test-api-key',
            model: 'voyage-4-nano',
        });

        expect(embedding.getDimension()).toBe(1024);
        await expect(embedding.detectDimension()).resolves.toBe(1024);
    });

    it('parses the leading default dimension from variable-dimension model metadata', () => {
        const defaultDimensionModels = [
            'voyage-4-large',
            'voyage-4',
            'voyage-4-lite',
            'voyage-4-nano',
            'voyage-code-3',
        ];

        for (const model of defaultDimensionModels) {
            const embedding = new VoyageAIEmbedding({
                apiKey: 'test-api-key',
                model,
            });

            expect(embedding.getDimension()).toBe(1024);
        }
    });
});
