import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        reporters: [
            ['html', { singleFile: true, outputFile: './reports/index.html' }]
        ]
    },
});
