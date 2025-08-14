import path from "path";
import CleanWebpackPluginPkg from "clean-webpack-plugin";
import CopyWebpackPlugin from "copy-webpack-plugin";
import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";
import webpack from "webpack";
import manifest from "./manifest.json" assert { type: "json" };
import { fileURLToPath } from "url";
const { DefinePlugin } = webpack
const { CleanWebpackPlugin } = CleanWebpackPluginPkg

export default ((_, argv) => {
    const production = argv.mode === "production"
    const releaseName = `${manifest.name}-${manifest.version}`
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    return {
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
            path: path.resolve(__dirname, production ? "release/" + releaseName : "dist")
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
                    test: /\.ts$/,
                    loader: "ts-loader",
                    options: {
                        transpileOnly: true 
                    }
                },
                {
                    test: /\.html$/,
                    loader: "html-loader"
                },
                // Loading Semantic UI's fonts in a content script doesn't work,
                // delete all except for the custom font that gets loaded via JS
                {
                    test: /\.(woff|woff2|ttf|svg|eot)$/,
                    loader: "ignore-loader"
                }
            ]
        },
        plugins: [
            new CleanWebpackPlugin(),
            new CopyWebpackPlugin({
                patterns: [
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
            new DefinePlugin({
                PRODUCTION: JSON.stringify(production),
                PIXIV_HELPER_EXTENSION_ID: JSON.stringify(production ? "" : process.env.PIXIV_HELPER_EXTENSION_ID)
            })
        ],
        optimization: {
            minimize: production
        }
    }}
)
