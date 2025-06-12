import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
         parserOptions: { // Add this section
            project: true, // This tells ESLint to find your tsconfig.json
            // If your tsconfig.json is not in the root, you might need:
            // tsconfigRootDir: import.meta.dirname, // Or the relative path to your tsconfig.json
        }
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        "@typescript-eslint/no-floating-promises": [
            "error",
            {
                "ignoreIIFE": true
            }
        ],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];