const path = require("path");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const RemovePlugin = require("remove-files-webpack-plugin");

module.exports = {
    mode: "development",
    // Without this, webpack uses "eval" which is not allowed in an extension
    devtool: 'cheap-module-source-map',
    entry: {
        background: "./src/js/pages/background.ts",
        settings: "./src/js/pages/settings.ts",
        contentScript: "./src/js/main.ts"
    },
    output: {
        publicPath: "",
        filename: "[name].js",
        path: path.resolve(__dirname, "dist")
    },
    resolve: {
        extensions: [".js", ".ts", ".scss", ".html"],
        modules: ["src", "node_modules"]
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: [
                    "style-loader",
                    "css-loader"
                ]
            },
            {
                test: /\.s(a|c)ss$/,
                use: [
                    "style-loader",
                    "css-loader",
                    "sass-loader"
                ]
            },
            {
                test: /\.(png|svg|jpg|gif)$/,
                use: [
                    "file-loader"
                ]
            },
            {
                test: /\.(woff|woff2|eot|ttf|otf)$/,
                use: [
                    "file-loader"
                ]
            },
            {
                test: /\.ts$/,
                loader: "ts-loader",
                options: {
                    transpileOnly: true 
                }
            },
            {
                test: /\.html$/,
                loader: "html-loader"
            }
        ]
    },
    plugins: [
        new CleanWebpackPlugin(),
        new CopyWebpackPlugin({
            patterns: [
                // { from: "src/html/popup.html" },
                { from: "src/html/settings.html" },
                { from: "manifest.json" },
                { from: "icons", to: "icons" },
                { from: "icons/gelbooru-icon-128.png", to: "128.png" },
                { from: "*.woff2" },
                { from: "changelog.md" },
                { from: "node_modules/jquery/dist/jquery.js", to: "jquery.js" }
            ]
        }),
        new ForkTsCheckerWebpackPlugin(),
        new RemovePlugin({
            "after": {
                root: "./dist",
                // Loading Semantic UI's fonts in a content script doesn't work,
                // delete all except for the custom font that gets loaded via JS
                test: [
                    {
                        folder: ".",
                        method: (path) => {
                            const ext = path.split(".").slice(-1)[0]
                            const extensions = ["eot", "ttf", "svg", "woff", "woff2"]
                            return !path.endsWith("icons.woff2") && extensions.includes(ext)
                        }
                    }
                ]
            }
        })
    ]
}
