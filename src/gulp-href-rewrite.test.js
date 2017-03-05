/* eslint-env jest */
import {readFileSync} from 'fs';
import {safeLoad} from 'js-yaml';
import {join, resolve} from 'path';
import through2 from 'through2';
import es from 'event-stream';
import Vinyl from 'vinyl';
import rewriteHref from './index';

// Set up a few virtual files to test on
const TEST_DATA = safeLoad(readFileSync(
  join(__dirname, '__test-data__/test-files.yml')
));

/**
 * Retrieve a stream of virtual files (specified in `test-files.yml`) based
 * on the fileset name.
 */
function getTestFiles(filesetName) {
  const fileset = TEST_DATA[filesetName];
  return es.readArray(fileset.files.map((file) => {
    const options = Object.assign({}, file, {
      cwd: fileset.cwd || fileset.base,
      base: fileset.base,
      path: resolve(fileset.base, file.path),
    });
    if (file.contents) options.contents = new Buffer(file.contents);
    return new Vinyl(options);
  }));
}

const streamAsPromise = (stream) => new Promise((ok, fail) => {
  let count = 0;
  stream.on('data', () => {
    count = count + 1;
  });
  stream.on('end', () => ok()).on('error', (err) => fail(err));
});

describe('gulp-href-rewrite', () => {
  it('should run without errors', () =>
    streamAsPromise(
      getTestFiles('sampleMd')
        .pipe(rewriteHref())
        .pipe(through2.obj((file, enc, done) => {
          expect(file).not.toBeUndefined();
          done();
        })))
  );
  it('should run a more complex case without errors', () =>
    streamAsPromise(
      getTestFiles('sampleMdDocs')
        .pipe(rewriteHref())
        .pipe(through2.obj((file, enc, done) => {
          expect(file).not.toBeUndefined();
          file.links && file.links.forEach((link) => {
            expect(file.rewriteHref(link.href)).toBe(link.expected);
          });
          done();
        })))
  );
  it('should move files along with their index file', () =>
    streamAsPromise(
      getTestFiles('movingFilesWithIndex')
        .pipe(rewriteHref())
        .pipe(through2.obj((file, enc, done) => {
          expect(file).not.toBeUndefined();
          file.links && file.links.forEach((link) => {
            expect(file.rewriteHref(link.href)).toBe(link.expected);
          });
          done();
        })))
  );
});
