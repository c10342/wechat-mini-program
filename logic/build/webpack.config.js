const path = require('path');

module.exports = {
  mode: 'development',
  entry: {
    logic: path.resolve(__dirname, '../src/index.js'),
  },
  output: {
    path: path.resolve(__dirname, '../public'),
    filename: 'core.js',
  },
  resolve: {
    extensions: ['.js'],
    alias: {
      '@': path.resolve(__dirname, '../src'),
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
            babelrc: true,
            configFile: path.resolve(__dirname, '../.babelrc')
          },
        }
      },
    ]
  }
};