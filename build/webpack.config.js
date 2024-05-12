const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  mode: 'development',
  devtool: 'source-map',
  entry: {
    nativeUi: path.resolve(__dirname, '../src/index.js'),
  },
  output: {
    path: path.resolve(__dirname, '../public'),
    filename: 'js/index.js',
    assetModuleFilename: 'images/[hash][ext][query]'
  },
  resolve: {
    extensions: ['.js', '.scss'],
    alias: {
      '@native': path.resolve(__dirname, '../src'),
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              [
                '@babel/preset-env',
                {
                  targets: {
                    browsers: ['cover 99.5%']
                  }
                }
              ]
            ],
            plugins: [
              [
                '@babel/plugin-transform-runtime',
                {
                  corejs: { version: 3 },
                },
              ]
            ]
          },
        }
      },

      {
        test: /\.html$/i,
        loader: "html-loader",
      },

      {
        test: /\.scss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
          },
          {
            loader: 'postcss-loader',
          },
          {
            loader: 'sass-loader',
          }
        ]
      },
    ]
  },
  plugins: [
    new MiniCssExtractPlugin({
        filename: "css/index.css",
    }),
    new HtmlWebpackPlugin({
        chunks: ['nativeUi'],
        title: 'Iphone 11 Pro',
        filename: 'index.html',
        favicon: path.resolve(__dirname, '../src/images/favicon.ico'),
        template: path.resolve(__dirname, '../html/index.ejs')
    }),
  ],
};