import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockEmbedding } from './bedrock-embedding';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
    BedrockRuntimeClient: jest.fn().mockImplementation((config) => ({ send: mockSend, config })),
    InvokeModelCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

function jsonResponse(body: unknown) {
    return {
        body: {
            transformToString: async () => JSON.stringify(body),
        },
    };
}

describe('BedrockEmbedding', () => {
    beforeEach(() => {
        mockSend.mockReset();
        (BedrockRuntimeClient as unknown as jest.Mock).mockClear();
        (InvokeModelCommand as unknown as jest.Mock).mockClear();
    });

    it('exposes known model metadata', () => {
        const supportedModels = BedrockEmbedding.getSupportedModels();

        expect(supportedModels['amazon.titan-embed-text-v2:0']).toMatchObject({
            dimension: 1024,
            family: 'titan',
        });
        expect(supportedModels['cohere.embed-english-v3']).toMatchObject({
            dimension: 1024,
            family: 'cohere',
        });
    });

    it('embeds a single text with Titan v2, requesting the configured dimensions', async () => {
        mockSend.mockResolvedValue(jsonResponse({ embedding: [1, 0, 0] }));

        const embedding = new BedrockEmbedding({
            model: 'amazon.titan-embed-text-v2:0',
            region: 'us-east-1',
        });

        const result = await embedding.embed('hello world');

        expect(result).toEqual({ vector: [1, 0, 0], dimension: 3 });
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(InvokeModelCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                modelId: 'amazon.titan-embed-text-v2:0',
                body: JSON.stringify({ inputText: 'hello world', dimensions: 1024, normalize: true }),
            })
        );
    });

    it('issues one InvokeModel call per text for Titan models (no native batching)', async () => {
        mockSend
            .mockResolvedValueOnce(jsonResponse({ embedding: [1, 0, 0] }))
            .mockResolvedValueOnce(jsonResponse({ embedding: [0, 1, 0] }));

        const embedding = new BedrockEmbedding({
            model: 'amazon.titan-embed-text-v1',
            region: 'us-east-1',
        });

        const results = await embedding.embedBatch(['first', 'second']);

        expect(results).toEqual([
            { vector: [1, 0, 0], dimension: 3 },
            { vector: [0, 1, 0], dimension: 3 },
        ]);
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('batches Cohere embeddings into a single InvokeModel call', async () => {
        mockSend.mockResolvedValue(jsonResponse({ embeddings: [[1, 0], [0, 1]] }));

        const embedding = new BedrockEmbedding({
            model: 'cohere.embed-english-v3',
            region: 'us-east-1',
        });

        const results = await embedding.embedBatch(['first', 'second']);

        expect(results).toEqual([
            { vector: [1, 0], dimension: 2 },
            { vector: [0, 1], dimension: 2 },
        ]);
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(InvokeModelCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                modelId: 'cohere.embed-english-v3',
                body: JSON.stringify({ texts: ['first', 'second'], input_type: 'search_document' }),
            })
        );
    });

    it('returns an empty batch without calling Bedrock', async () => {
        const embedding = new BedrockEmbedding({
            model: 'amazon.titan-embed-text-v2:0',
            region: 'us-east-1',
        });

        await expect(embedding.embedBatch([])).resolves.toEqual([]);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('throws a clear error when the Titan response has no embedding field', async () => {
        mockSend.mockResolvedValue(jsonResponse({ unexpected: true }));

        const embedding = new BedrockEmbedding({
            model: 'amazon.titan-embed-text-v2:0',
            region: 'us-east-1',
        });

        await expect(embedding.embed('hello')).rejects.toThrow(/no "embedding" field/);
    });

    it('passes static credentials through to the Bedrock client when provided', () => {
        new BedrockEmbedding({
            model: 'amazon.titan-embed-text-v2:0',
            region: 'us-east-1',
            accessKeyId: 'AKIA_TEST',
            secretAccessKey: 'secret',
            sessionToken: 'session',
        });

        expect(BedrockRuntimeClient).toHaveBeenCalledWith(
            expect.objectContaining({
                region: 'us-east-1',
                credentials: {
                    accessKeyId: 'AKIA_TEST',
                    secretAccessKey: 'secret',
                    sessionToken: 'session',
                },
            })
        );
    });

    it('omits credentials from the client config when not provided, relying on the default chain', () => {
        new BedrockEmbedding({
            model: 'amazon.titan-embed-text-v2:0',
            region: 'us-east-1',
        });

        const callArgs = (BedrockRuntimeClient as unknown as jest.Mock).mock.calls[0][0];
        expect(callArgs.credentials).toBeUndefined();
    });
});
