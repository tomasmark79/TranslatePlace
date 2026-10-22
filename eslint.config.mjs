export default [{
    files: ['*.js'],
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: {global: 'readonly', logError: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly'},
    },
    rules: {
        'no-undef': 'error',
        'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
        'no-unreachable': 'error',
        'no-unsafe-finally': 'error',
        'no-dupe-args': 'error',
        'no-dupe-keys': 'error',
        'no-dupe-class-members': 'error',
        'no-duplicate-case': 'error',
        'no-constant-condition': 'error',
        'valid-typeof': 'error',
        'max-len': ['error', {code: 200}],
    },
}];
